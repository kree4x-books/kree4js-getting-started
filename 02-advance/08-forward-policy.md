# 服务转发：使用ForwardPolicy定制转发策略

> Created By [RV](mailto:rodney.vin@gmail.com), and licensed with Creative Commons "[CC BY-NC-ND 4.0](https://creativecommons.org/licenses/by-nc-nd/4.0/)"

**目的与场景**

在这一章，讲解如何使用 **ForwardPolicy**，为**帧转发**（Frame Forwarding）定制**放行/拦截策略**。

转发节点，按转发策略决定，哪些帧允许被转发、哪些帧必须被拦截。

### 一. 概念

**1. 帧转发：Frame Forwarding**

开放了代理模式（proxyMode）的服务节点，会转发"目标节点ID不是自身"的数据帧，使通信网格中两个非直连节点可以间接通信。

帧转发模式，**默认是关闭的**。

单纯出于安全考虑——默认开放转发，服务网格，极易在无意间将内部服务暴露给外部。

开启后，转发的帧类型可进一步被 **ForwardPolicy** 精确控制。

**2. 转发策略：ForwardPolicy**

转发策略是"两层"决策：

- `shouldForward()`：**全局决策**——该帧整体上是否允许被转发。
- `shouldForwardTo()`：**逐连接过滤**——该帧是否可以通过某条特定连接送出。

两方法语义一致：返回 `true` = 放行，返回 `false` = 拦截。

**3. 两种转发模式**

- `forwardAllowAll()`：**黑名单**模式，默认放行全部帧，可注册 `blockForwardWhen()` 拦截特定帧（proxyMode的默认模式）。
- `forwardDenyAll()`：**白名单**模式，默认拦截全部帧，需注册 `allowForwardWhen()` 放行特定帧。

**4. 內建的ForwardPolicy**

| 策略类 | 作用 |
|------|------|
| `AllForwardPolicy` | 放行所有帧，即"全开放"。 |
| `PduTypeFilterPolicy({allow?, block?})` | 按PDU类型**白名单/黑名单**过滤。 |
| `DirectionFilterPolicy({attach?, listen?})` | 按帧的来源方向（attach/listen）过滤。 |
| `FrameLimitFilterPolicy` | 按目标连接的帧大小上限过滤，防帧溢出。 |

### 二. 示例代码

在下边的示例中，我们将：

- node-c：**服务开放者**，注册 `greet` 服务，proxy节点直连node-c，node-a与node-c无直接连接
- proxy：**转发节点**，开启 proxyMode，桥接node-a与node-c
- node-a：**调用发起者**，只能连到proxy节点

**1. 建立连接拓扑**

```javascript
// node-c：服务开放者，注册greet服务
const nodeC = create('node-c')
nodeC.register('greet', {
  hello (name) { return `Hello, ${name}! (from node-c)` },
  ping () { return 'pong' }
})
nodeC.listen('tcp://127.0.0.1:8062')

// proxy：转发节点，开启proxyMode
const proxy = create('proxy', undefined, { transport: { proxyMode: true } })
proxy.attach('tcp://127.0.0.1:8062')
proxy.listen('tcp://127.0.0.1:8061')

// node-a：调用发起者，只能连proxy
const nodeA = create('node-a')
nodeA.attach('tcp://127.0.0.1:8061')

const greet = nodeA.service('greet', { timeout: 2000 })
```

**2. 默认模式：proxyMode即allowAll**

开启proxyMode后，默认**放行所有帧**，调用直通：

```javascript
// 默认allowAll：转发全部放行
await greet.hello('World')   // Hello, World! (from node-c)
```

**3. 白名单：denyAll + PduTypeFilterPolicy**

`forwardDenyAll()` 后默认**拦截所有帧**，再 `allowForwardWhen()` 注册放行规则。以下只放行Beacon/IHave信号，**业务调用帧被拦截**：

```javascript
// 只放行Beacon/IHave信号，拦截业务调用帧
proxy.transport.forwardDenyAll()
  .allowForwardWhen(new PduTypeFilterPolicy({
    allow: [PDUType.BeaconSignal, PDUType.IHaveSignal]
  }))

try {
  await greet.hello('blocked')
} catch (err) {
  // hello 被拦截：调用超时抛出异常
}
```

**4. 恢复：forwardAllowAll()**

策略**热更新**，即改即生效：

```javascript
proxy.transport.forwardAllowAll()
await greet.ping()   // pong：已恢复
```

**5. 自定义ForwardPolicy**

实现 `ForwardPolicy` 的子类，覆盖 `shouldForward()` 即可注入自定义策略。以下只放行业务调用帧（ServiceCall/ServiceCallResult），禁止管理类信号穿透：

```javascript
// 自定义ForwardPolicy：只放行业务调用帧
class BusinessCallPolicy extends Transports.ForwardPolicy {
  shouldForward (ctx, directData) {
    return directData.pduType === PDUType.ServiceCall ||
      directData.pduType === PDUType.ServiceCallResult
  }
}

proxy.transport.forwardDenyAll()
  .allowForwardWhen(new BusinessCallPolicy())
await greet.hello('again')   // 业务帧放行，调用成功
```

### 三. 须强调的细节

**1. 帧转发默认关闭**

`proxyMode` 默认 `false`，节点不转发任何帧。

仅在明确需要时开启（如API网关、内部通信网格），防止内部服务节点无意暴露于外部。

**2. allowForwardWhen / blockForwardWhen 各自限定模式**

- `allowForwardWhen()` **只能**在 `denyAll` 模式下调用，否则抛错。
- `blockForwardWhen()` **只能**在 `allowAll` 模式下调用，否则抛错。

**3. 多策略组合语义**

- **同一次调用**中的多个策略：如`allowForwardWhen(p1, p2)`, AND语义，全部放行为真，才放行。
- **多次调用**注册的多组策略：`allowForwardWhen(p1)`，`allowForwardWhen(p2)`，OR语义，任一组满足，即放行。

**4. PduTypeFilterPolicy 的匹配规则**

- 只给 `block`：黑名单，命中的类型被拦截，其余放行。
- 只给 `allow`：白名单，命中的类型放行，其余被拦截。
- 同时给 `block`/`allow`：`block` 优先（先查黑名单，再查白名单）。
- 都不给：放行所有类型。

**5. 防止转发风暴**

网格转发使用多种机制抑制风暴：**HOPs计数**（减至0丢弃）、**环路检测**（节点ID已在Hop列表中则丢弃）、**滤重**（使用滑动窗口过滤）。

**6. 策略热更新**

`forwardDenyAll()`/`forwardAllowAll()`/`allowForwardWhen()` 随时可调用，下一次帧转发即按新策略判定，无需重启节点。

### 四. 涉及到的API

**1. 模式切换：transport.forwardAllowAll() / forwardDenyAll()**

```typescript
/**
 * 切换到黑名单（allowAll）模式：默认放行全部帧，可用blockForwardWhen()拦截。
 *
 * @returns {this} 当前Transport，支持链式。
 */
forwardAllowAll(): this

/**
 * 切换到白名单（denyAll）模式：默认拦截全部帧，需allowForwardWhen()放行。
 *
 * @returns {this} 当前Transport，支持链式。
 */
forwardDenyAll(): this
```

**2. 注册规则：transport.allowForwardWhen() / blockForwardWhen()**

```typescript
/**
 * 注册放行规则（仅denyAll模式可用）：同一次调用的策略AND，多次调用OR。
 *
 * @param {...ForwardPolicy} policies - 放行策略。
 * @returns {this} 当前Transport，支持链式。
 */
allowForwardWhen(...policies): this

/**
 * 注册拦截规则（仅allowAll模式可用）：同一次调用的策略AND，多次调用OR。
 *
 * @param {...ForwardPolicy} policies - 拦截策略。
 * @returns {this} 当前Transport，支持链式。
 */
blockForwardWhen(...policies): this
```

**3. ForwardPolicy：转发策略基类**

```typescript
/**
 * 帧转发控制策略，两层决策：
 * shouldForward()：全局决策；shouldForwardTo()：逐连接过滤。
 */
class ForwardPolicy {
  /**
   * 全局决策：该帧是否允许被转发。
   *
   * @param {TransportContext} ctx - 当前传输上下文。
   * @param {DirectDataIncoming} directData - 收到的直接数据。
   * @returns {boolean} true=放行，false=拦截。
   */
  shouldForward(ctx, directData): boolean

  /**
   * 逐连接过滤：该帧是否可通过指定连接送出。
   *
   * @param {TransportContext} ctx - 当前传输上下文。
   * @param {DirectDataIncoming} directData - 原始直接数据。
   * @param {Channel} channel - 目标通道。
   * @param {Connection} connection - 目标连接。
   * @returns {boolean} true=放行，false=拦截。
   */
  shouldForwardTo(ctx, directData, channel, connection): boolean
}
```

**4. 內建的转发策略实现**

| 类名 | 作用 |
|------|------|
| `AllForwardPolicy` | `shouldForward()` 恒返回 `true`，放行所有帧。 |
| `PduTypeFilterPolicy({allow?, block?})` | 按 `directData.pduType` 白名单/黑名单过滤（零拷贝，不解码）。 |
| `DirectionFilterPolicy({attach?, listen?})` | 按来源连接方向（`connection.isAttach`）过滤：`attach`/`listen` 各自的 `block`/`allow`。 |
| `FrameLimitFilterPolicy` | `shouldForwardTo()` 检查目标连接 `frameLimit`，帧超限则拦截。 |

### 五. 可运行代码

完整示例代码，参见：<a href="../examples/02-advance/08-forward-policy.mjs" target="_blank">08-forward-policy.mjs</a>