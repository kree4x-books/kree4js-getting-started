# 动态链路：开启通信协商，支持动态链路直连与断线重连

> Created By [RV](mailto:rodney.vin@gmail.com), and licensed with Creative Commons "[CC BY-NC-ND 4.0](https://creativecommons.org/licenses/by-nc-nd/4.0/)"

**目的与场景**

在上一章《异构组网：多通信协议融合，组建通信网格》中，异构网络经桥接节点彼此连通，任意两个节点都可通信。

但**跨协议、非直连的调用，要经桥接节点转发**，链路每多一跳，就多一份延迟与开销。

在这一章，讲解如何**开启通信协商**，驱使间接可达的节点，如果支持共同通信协议，在首次调用时自动协商、建立**动态直连**。

以及当节点重启、网络抖动等原因，直连断开后，下一次调用能自动**重新协商**，恢复直连。

### 一. 概念

**1. 动态协商：Dynamic Negotiation**

开启动态协商后，两个节点满足条件时，会自动协商、建立直连：

- 双方协议能力存在交集（如都支持tcp），可协商出共同协议
- 直连建立后，后续调用直接通信，不再经桥接节点转发

对使用者完全透明：**无需改变调用方式**，协商由系统自动完成。

**2. 协商策略：Advice Policy**

Kree4X的协商，由**协商策略**（Advice Policy）驱动。策略决定：

- 是否建议建立直连
- 协商候选的协议及顺序
- 直连的目标地址

默认策略为 `ProtocolMatchAdvicePolicy`：

- 找出双方**协议能力**的交集，按此交集生成协商候选。
- 协议能力，来自beacon广播信号所携带的attach/listen能力声明

**3. 能力交集 ≠ 全部可用**

策略按"能力交集"生成候选协议，但**能力集合并不等于可用集合**：

- `tcp` 能力任意节点都可用（无需额外配置）
- `https`/`tls` 能力需要**证书**，无证书环境下协商必然失败
- `wss`/`socketio` 等协议，需要配套服务端支持

默认策略会**一次携带全部交集协议**（有序列表，如 tcp → udp → http → ... → wss），按顺序尝试、首次成功时终止；也可用 `useDynamicConnectionProtocols()` 白名单限定候选协议及顺序（见示例）。

**4. 监听地址与端口：限定动态监听**

协商建立直连时，需要一方**开启监听**，等待另一方连接。

如果一方已在监听，则另外一方直接连接即可。

否则，则需要动态开启监听，这则涉及到“**监听地址**”与“**监听端口**”的问题。

这个动态监听的绑定地址与端口，默认是：

- 地址：`0.0.0.0` ，绑定所有网卡接口，生产环境很危险
- 端口：操作系统随机自动分配，生产环境往往需要白名单，避免被防火前屏蔽

系统功能支持动态协商时，限定监听的地址和端口：

```javascript
node.transport.limitDynamicListenAddress('127.0.0.1', '10.0.1.2')      // 多个地址
node.transport.limitDynamicListenPort(8070)                           // 固定端口
node.transport.limitDynamicListenPort([8070, 8071])                   // 端口列表
node.transport.limitDynamicListenPort({ min: 8070, max: 8080 })       // 端口范围
```

**5. 断线重连**

因节点停止、重启、网络抖动等导致直连断开，**下一次调用会再次协商**，重新建立直连：

- 调用发起时，若直连不可用，自动经中继转发完成调用
- 同时触发重新协商，恢复直连

### 二. 示例代码

在下边的示例中，我们将组建一张 **TCP网格**，并开启动态协商：

- node-a：注册 `greet` 服务，开启动态协商
- node-b：服务调用者，开启动态协商
- center：网格中心（proxyMode中继），node-a/node-b 均 attach 到 center

**1. 限定协商协议：白名单 + 优先顺序**

开启动态协商后，默认策略会把双方共同支持的**全部协议**（http/https/tcp/tls/...）都列为协商候选。

使用 `useDynamicConnectionProtocols()` 可以指定协商时，允许的**协议白名单及其优先顺序**：

```javascript
node.useDynamicConnectionProtocols(['tcp'])               // 只协商 tcp
node.useDynamicConnectionProtocols(['tcp', 'ws'])         // 白名单 + 优先顺序：tcp 优先，失败再 ws
node.useDynamicConnectionProtocols(undefined)             // 清除配置，回退默认（全部共同协议）
```

白名单语义：

- **两端生效**：双方都可设置白名单，实际可协商的为双方白名单的交集

- **尝试顺序以发起方为准**：发起方按自己白名单的顺序携带协议，响应方按该顺序尝试 listen，首个成功即建立

- **未配置的一方 = 无限制**：不设置白名单，则代表无协议限制。

- **白名单设定了服务节点不支持的协议**：仅日志输出警告，然后跳过

  

advise()，返回的"**协商建议**"，包含两种场景：

- `needsNegotiation: true`，需要一方开启Listen，要动态**协商候选**，决定谁来Listen，谁来Attach
- `needsNegotiation: false` ，一方已经在Listen，不需要协商，直接连接即可

**2. 组建网格：center + 两个协商节点**

```javascript
// center：网格中心，proxyMode开启帧中继
const center = create('center', 'Grid center', { transport: { proxyMode: true } })
center.listen(`tcp://127.0.0.1:${PORT_CENTER}`)

// node-a：服务提供者，开启动态协商
const nodeA = create('node-a', 'Service provider')
nodeA.register('greet', {
  hello (name) { return `Hello, ${name}! (from node-a)` }
})
// 开启动态协商功能
nodeA.transport.enableDynamicConnection()
// 协议白名单，设定允许的通信协议，及其顺序
nodeA.useDynamicConnectionProtocols(['tcp'])

// 限定动态监听只绑定本机回环，避免默认暴露到所有网卡（0.0.0.0）
nodeA.transport.limitDynamicListenAddress('127.0.0.1')
nodeA.attach(`tcp://127.0.0.1:${PORT_CENTER}`)

// node-b：服务调用者，开启动态协商
const nodeB = create('node-b', 'Service caller')
nodeB.useDynamicConnectionProtocols(['tcp'])
nodeB.transport.enableDynamicConnection()
// 限制动态监听地址
nodeB.transport.limitDynamicListenAddress('127.0.0.1')
nodeB.attach(`tcp://127.0.0.1:${PORT_CENTER}`)

await center.start()
await nodeA.start()
await nodeB.start()
```

**3. 首次调用：经中继转发，同时触发协商**

首次调用时，网格发现与协商是异步进行的，调用结果先经 center 转发返回：

```javascript
const greet = nodeB.service('greet', { timeout: 8000 })

logger.info(`[1] node-b → node-a.greet.hello('World') = ${await greet.hello('World')}`)
// Hello, World! (from node-a)
logger.info(`    node-b 与 node-a 直连：${nodeB.transport.grid.hasDirectChannel(nodeA.id)}`)
// false —— 直连尚未建立，本次调用经 center 转发
```

`grid.hasDirectChannel(nodeId)` 用于查询与目标节点是否已建立直连。

**4. 等待协商完成，验证直连**

直连的建立在后台异步进行（多轮握手），需要时间，轮询等待其完成：

```javascript
// 轮询等待动态直连建立（协商为异步多轮握手，需要时间）
async function waitDirect (node, targetId, timeoutMs = 8000, expectDirect = true) {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    if (node.transport.grid.hasDirectChannel(targetId) === expectDirect) return true
    await PromiseUtils.delay(100)
  }
  return false
}

const direct = await waitDirect(nodeB, nodeA.id)
logger.info(`[2] 协商完成，node-b 与 node-a 直连：${direct}`)
// true
```
> 生产环境，无需此等待。直连还是间接转发，对一次服务调用而言，是不可见、不感知的。

**5. 再次调用：直连通信**

直连建立后，后续调用走直连通道，**不再经 center 转发**：

```javascript
logger.info(`[3] node-b → node-a.greet.hello('Again') = ${await greet.hello('Again')}`)
// Hello, Again! (from node-a)
```

**6. 断线重连：node-b 停止，直连断开**

停止 node-b，直连随即断开：

```javascript
// 停止前留时间让直连数据链路稳定（断线检测与动态监听清理需要时间）
await PromiseUtils.delay(100)
await nodeB.stop()
const broken = await waitDirect(nodeA, nodeB.id, 8000, false)
logger.info(`[4] node-b 已停止，直连断开：${broken}`)
// true
```

注意：

- 在node-a侧查询 `hasDirectChannel(nodeB.id)`，结果同步变为 `false`
- 断开检测同样需要时间（连接清理），故同样轮询

**7. 重启 node-b：再次调用，重新协商**

重建node-b（attach 到center），再次调用 `hello`：

```javascript
const nodeB2 = create('node-b', 'Service caller (reconnected)')
nodeB2.useDynamicConnectionProtocols(['tcp'])
nodeB2.transport.enableDynamicConnection()
// 限制动态监听地址
nodeB2.transport.limitDynamicListenAddress('127.0.0.1')
nodeB2.attach(`tcp://127.0.0.1:${PORT_CENTER}`)
await nodeB2.start()

const greet2 = nodeB2.service('greet', { timeout: 8000 })
logger.info(`[5] node-b 重启，重新协商直连：${await greet2.hello('Again')}`)
// Hello, Again! (from node-a) —— 调用经 center 转发成功
const direct2 = await waitDirect(nodeB2, nodeA.id)
logger.info(`    重新协商完成，node-b 与 node-a 直连：${direct2}`)
// true
```

断线重连全程无需业务代码干预：**调用自动触发重新协商，直连自动恢复**。

### 三. 须强调的细节

**1. 协商是异步的，直连建立需要时间**

首次调用**先经中继完成**，直连在后台上异步建立（多轮握手）。

示例用 `waitDirect()` 轮询等待，便于观察各阶段状态。

生产环境不需要轮询：当下一次调用时，直连已就绪，自动走直连。

**2. 自定义协商策略（高级）**

多数场景用 `useDynamicConnectionProtocols()` 白名单即可，无需自定义策略。

需要更精细的控制，如按节点/按地址进行控制，再自定义：

- 继承 `ProtocolMatchAdvicePolicy`，覆写 `advise()`。在父类建议列表上过滤，不是必须，但可简化实现。
- 返回 `undefined` 表示**否决**（不建议建立直连）
- 返回建议数组，**顺序即优先级**：array中靠前的建议先尝试
- 注意：协商候选建议（`needsNegotiation: true`）携带的是 **`protocols` 有序数组**

**3. 断线重连的适用条件**

- 模拟断线时，示例使用 `stop() + 重建节点`模拟网络抖动
- 重连的前提，是双方仍具备协议能力交集。能力不变，重新协商自会成功

**4. 仅协商一次 vs 持续可用**

动态直连建立后**持续可用**，不是每次调用都协商：

- 已有直连时，直接走直连通道，零协商开销
- 直连通道闲置后，会被自动断开
- 有新的调用，会再次出发直连

### 四. 涉及到的API

**1. 开启动态协商**

```typescript
/**
 * 开启动态协商，可指定协商策略。
 * 不传策略时，默认使用 ProtocolMatchAdvicePolicy。
 * 多个策略按 AND 语义评估：全部通过才建议直连。
 *
 * @param {...DynamicConnectionAdvicePolicy} policies - 协商策略。
 * @returns {this} 当前节点，支持链式。
 */
enableDynamicConnection(...policies): this
```

```javascript
// 开启动态协商，默认支持所有协议
node.transport.enableDynamicConnection()
// 自定义策略（多个策略按 AND 语义评估，全部通过才建议直连）
node.transport.enableDynamicConnection(myPolicyA, myPolicyB)

// 限定可协商协议范围
node.useDynamicConnectionProtocols(['tcp'])
```

**2. 关闭动态协商**

```typescript
/**
 * 关闭动态协商，并清空协商策略。
 *
 * @returns {this} 当前节点，支持链式。
 */
disableDynamicConnection(): this
```

**3. 查询直连状态**

```typescript
/**
 * 检查与目标节点是否已建立动态直连。
 *
 * @param {string} targetNodeId - 目标节点ID。
 * @returns {boolean} 存在直连返回 true。
 */
kree4x.transport.grid.hasDirectChannel(targetNodeId): boolean
```

**4. 协商策略基类**

```typescript
/**
 * 协商策略基类。自定义策略需覆写 advise()。
 */
abstract class DynamicConnectionAdvicePolicy {
  /**
   * 给出直连建议。
   *
   * @param {TransportContext} ctx - 当前调用的传输上下文。
   * @param {string} targetNodeId - 目标节点ID。
   * @param {ConnectionAdvice[]} currentAdvices - 上游策略累积的建议。
   * @returns {ConnectionAdvice[]|undefined} 建议数组（顺序即优先级）；undefined 表示否决。
   */
  advise(ctx, targetNodeId, currentAdvices): ConnectionAdvice[] | undefined
}

// 建议项结构
type ConnectionAdvice = {
  url?: string            // 直接地址（needsNegotiation=false 时）
  protocol?: string       // 已废弃：旧单协议形态（向后兼容保留）
  protocols?: string[]    // 协商候选的有序协议列表（needsNegotiation=true 时，优先于 protocol）
  needsNegotiation: boolean // true=协商候选，false=直接地址
}
```

**5. 限定协商协议：白名单 + 优先顺序**

```typescript
/**
 * 限定动态直连协商的协议白名单及其优先顺序。
 * 只允许白名单内协议参与协商（发起方、响应方两端生效），且按白名单顺序优先。
 * 传 null/undefined 清除配置，回退默认行为（全部共同协议，按能力顺序）。
 * 参数非数组时抛错；含本地不支持（未注册 capability）的协议时仅打 warn。
 * 重复协议自动去重。
 *
 * @param {string[]|null|undefined} protocols - 有序协议白名单。
 * @returns {this} 当前节点，支持链式。
 */
useDynamicConnectionProtocols(protocols): this
```

```javascript
node.useDynamicConnectionProtocols(['tcp'])
node.useDynamicConnectionProtocols(['tcp', 'ws'])
node.useDynamicConnectionProtocols(undefined) // 清除白名单
```

**6. 限定动态监听地址与端口**

```typescript
/**
 * 限定动态监听绑定的地址。
 * 未设置时默认绑定 0.0.0.0（所有网卡接口），服务会暴露给所有网卡。
 * 可传多个地址，支持链式调用。
 *
 * @param {...string} addresses - 允许绑定的IP地址，如 '127.0.0.1'。
 * @returns {this} 当前节点，支持链式。
 */
limitDynamicListenAddress(...addresses): this

/**
 * 限定动态监听使用的端口：单个固定端口。
 * 不设置时，端口自动分配；支持链式调用。
 *
 * @param {number} port - 单个端口，如 8070。
 * @returns {this} 当前节点，支持链式。
 */
limitDynamicListenPort(port: number): this

/**
 * 限定动态监听使用的端口：端口列表。
 * 端口从列表内随机分配；不设置时自动分配；支持链式调用。
 *
 * @param {number[]} port - 端口列表，如 [8070, 8071]。
 * @returns {this} 当前节点，支持链式。
 */
limitDynamicListenPort(port: number[]): this

/**
 * 限定动态监听使用的端口：端口范围。
 * 端口在范围内分配；不设置时自动分配；支持链式调用。
 *
 * @param {{min: number, max: number}} port - 端口范围，如 { min: 8070, max: 8080 }。
 * @returns {this} 当前节点，支持链式。
 */
limitDynamicListenPort(port: { min: number, max: number }): this
```

```javascript
node.transport.limitDynamicListenAddress('127.0.0.1')
node.transport.limitDynamicListenPort(8070)
node.transport.limitDynamicListenPort([8070, 8071])
node.transport.limitDynamicListenPort({ min: 8070, max: 8080 })
```

### 五. 可运行代码

完整示例代码，参见：<a href="../examples/02-advance/10-dynamic-negotiation.mjs" target="_blank">10-dynamic-negotiation.mjs</a>