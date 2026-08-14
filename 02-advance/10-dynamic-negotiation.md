# 动态链路：开启通信协商，支持动态链路直连与断线重连

> Created By [RV](mailto:rodney.vin@gmail.com), and licensed with Creative Commons "[CC BY-NC-ND 4.0](https://creativecommons.org/licenses/by-nc-nd/4.0/)"

**目的与场景**

在上一章《异构组网：多通信协议融合，组建通信网格》中，异构网络经桥接节点彼此连通，任意两个节点都可通信。

但**跨协议、非直连的调用，要经桥接节点转发**，链路每多一跳，就多一份延迟与开销。

在这一章，讲解如何**开启通信协商**，让支持共同通信协议的节点，在首次调用时自动协商、建立**动态直连**。

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

默认策略会依次尝试全部交集（如  tcp → udp → http → ... → wss），首次成功时终止。

**4. 监听地址与端口：限定动态监听**

协商建立直连时，需要一方**开启监听**，等待另一方连接。

如果一方已在监听，则另外一方直接连接即可。

否则，则需要动态开启监听，这则涉及到“**监听地址**”与“**监听端口**”的问题。

这个动态监听的绑定地址与端口，默认是：

- 地址：`0.0.0.0` ，绑定所有网卡接口，生产环境很危险
- 端口：操作系统随机自动分配，生产环境往往需要白名单，避免被防火前屏蔽

系统功能支持动态协商时，限定监听的地址和端口：

```javascript
node.transport.limitDynamicListenAddress('127.0.0.1','10.0.1.2')      // 多个地址
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

**1. 自定义协商策略：只协商 tcp**

示例用一个自定义策略 `TcpOnlyAdvicePolicy`，继承默认策略并在建议列表中**过滤掉非tcp协议**：

```javascript
// 只支持tcp协议的自定义协商
class TcpOnlyAdvicePolicy extends ProtocolMatchAdvicePolicy {
  advise (ctx, targetNodeId, currentAdvices = []) {
    const advices = super.advise(ctx, targetNodeId, currentAdvices)
    if (advices == null) return undefined
    return advices.filter(advice => {
      if (advice.needsNegotiation) {
        return advice.protocol === 'tcp'
      }
      return advice.url != null && advice.url.startsWith('tcp://')
    })
  }
}

// 只允许本机回环地址直连的自定义协商
// 注意：super.advise() 会基于能力重新生成全部协议候选（http/https/tls/...），
// 因此 needsNegotiation 分支同样需过滤协议，否则 tls/https 会在无证书环境下尝试失败。
class LanOnlyAdvicePolicy extends ProtocolMatchAdvicePolicy {
  advise (ctx, targetNodeId, currentAdvices = []) {
    const advices = super.advise(ctx, targetNodeId, currentAdvices)
    if (advices == null) return undefined
    return advices.filter(advice => {
      if (advice.needsNegotiation) {
        return advice.protocol === 'tcp'
      }
      return advice.url != null && advice.url.startsWith('tcp://127.0.0.1')
    })
  }
}
```

advise()，返回的“**协商建议**”，包含两种场景：

- `needsNegotiation: true` ，需要一方Listen，要动态**协商候选**，决定谁来Listen，谁来Attach
- `needsNegotiation: false` 的建议，一方已经在Listen，不需要协商，直接连接即可

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
// 单行传入多个策略：AND语义，全部通过才建议直连（tcp + 仅本机回环地址）
nodeA.transport.enableDynamicConnection(new TcpOnlyAdvicePolicy(), new LanOnlyAdvicePolicy())
// 限定动态监听只绑定本机回环，避免默认暴露到所有网卡（0.0.0.0）
nodeA.transport.limitDynamicListenAddress('127.0.0.1')
nodeA.attach(`tcp://127.0.0.1:${PORT_CENTER}`)

// node-b：服务调用者，开启动态协商
const nodeB = create('node-b', 'Service caller')
nodeB.transport.enableDynamicConnection(new TcpOnlyAdvicePolicy(), new LanOnlyAdvicePolicy())
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
    await new Promise(resolve => setTimeout(resolve, 100))
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
nodeB2.transport.enableDynamicConnection(new TcpOnlyAdvicePolicy())
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

**2. 自定义协商策略**

- 继承 `ProtocolMatchAdvicePolicy`，覆写 `advise()`，在父类建议列表上过滤。不是必须，但会简化实现。
- 返回 `undefined` 表示**否决**（不建议建立直连）
- 返回建议数组，**顺序即优先级**：array中靠前的建议先尝试

**3. 断线重连的适用条件**

- 模拟断线时，示例使用 `stop() + 重建节点`；真实网络抖动（拔线、进程crash）同理
- 重连的前提，是双方仍具备协议能力交集；能力不变，重新协商自动成功

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
// 默认策略
node.transport.enableDynamicConnection()

// 自定义单策略
node.transport.enableDynamicConnection(new TcpOnlyAdvicePolicy())

// 单行传入多个策略：AND语义，全部通过才建议直连
node.transport.enableDynamicConnection(new TcpOnlyAdvicePolicy(), new LanOnlyAdvicePolicy())
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
grid.hasDirectChannel(targetNodeId): boolean
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
  protocol?: string       // 协商协议（needsNegotiation=true 时）
  needsNegotiation: boolean // true=协商候选，false=直接地址
}
```

**5. 限定动态监听地址与端口**

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
 * 限定动态监听使用的端口。
 * 不设置时，端口自动分配。
 *
 * @param {number|number[]|{min: number, max: number}} port - 单个端口 / 端口列表 / 端口范围。
 * @returns {this} 当前节点，支持链式。
 */
limitDynamicListenPort(port): this
```

```javascript
node.transport.limitDynamicListenAddress('127.0.0.1')
node.transport.limitDynamicListenPort(8070)
```

### 五. 可运行代码

完整示例代码，参见：[10-dynamic-negotiation.mjs](../examples/02-advance/10-dynamic-negotiation.mjs)