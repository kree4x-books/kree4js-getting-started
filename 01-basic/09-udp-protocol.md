# 使用UDP协议连接

> Created By [RV](mailto:rodney.vin@gmail.com), and licensed with Creative Commons "[CC BY-NC-ND 4.0](https://creativecommons.org/licenses/by-nc-nd/4.0/)"

**目的与场景**

在这一章，讲解**两个NodeJS节点**如何通过UDP协议互联，实现双向RPC调用。

### 一. 概念

**1. UDP协议**

UDP是面向数据报的无连接传输协议：

- 不建立连接、无握手，每个消息是一个独立数据报
- 收发双方只需要知道对方的 (IP, 端口) 即可发送数据
- 不保证送达：数据报可能丢失、乱序、重复
- 没有TCP的拥塞控制与重传机制，单帧大小天然受限

与TCP不同，UDP没有keepalive / 重连概念，连接的可靠性完全由应用层保证。

**2. 分帧（frameLimit）**

UDP单帧大小受MTU限制，过大的数据报会触发IP分片，增加丢失风险。Kree4X通过 `frameLimit` 将消息切分为多个帧发送，接收端自动重组。

- UDP建议 `frameLimit: 1152`，避免IP分片
- 该值需在网络中的每一个节点保持一致，否则会在转发节点触发帧重组，虚耗资源

**3. 帧级ACK（ack）**

UDP传送不可靠，Kree4X提供可选的帧级ACK机制保证可靠传输：

- `ack: true` 时，每帧发送后等待ACK响应，超时未收到则自动重试
- 不启用ack时，无可靠性保证

### 二. 示例代码

在下边的示例中，我们将：

- nodeA作为UDP服务器，监听端口8060，注册calc服务
- nodeB作为UDP客户端，连接nodeA，注册str服务
- nodeB调用nodeA的calc服务
- nodeA调用nodeB的str服务（双向互调）

```javascript
import Kree4n from '@kree4js/kree4n'

// ── Node A（UDP服务器，注册calc服务） ─────────────
const nodeA = Kree4n.create('node-a', 'UDP RPC server')
nodeA.register('calc', {
  add (a, b) { return a + b },
  multiply (a, b) { return a * b }
})
// ack: true启用帧级ACK，保证UDP消息可靠到达
nodeA.listen('udp://127.0.0.1:8060', { frameLimit: 1152, ack: true })

// ── Node B（UDP客户端，注册str服务） ─────────────
const nodeB = Kree4n.create('node-b', 'UDP RPC client')
nodeB.register('str', {
  echo (msg) { return `Echo: ${msg}` },
  greet (name) { return `Hello, ${name}! (via UDP)` }
})
nodeB.attach('udp://127.0.0.1:8060', { frameLimit: 1152, ack: true })

await nodeA.start()
await nodeB.start()

// node-b调用node-a的calc服务
const calc = nodeB.service('calc')
const addResult = await calc.add(10, 20)      // 30
const mulResult = await calc.multiply(6, 7)   // 42

// node-a调用node-b的str服务（双向）
const str = nodeA.service('str')
const echoResult = await str.echo('UDP works!')   // "Echo: UDP works!"
const greetResult = await str.greet('World')        // "Hello, World! (via UDP)"

```

### 三. 须强调的细节

**1. 必须分帧**

UDP数据报大小受限，超出限制的消息必须分帧传输。

不设置 `frameLimit` 或设置过大时（>1152），可能会触发IP分片，降低传输可靠性。

**2. 可靠性由ack保证**

UDP本质不可靠：

- 数据报可能丢包，可能乱序到达
- Kree4X Transport传输层可保证数据帧的乱序、拖帧、粘帧重组，但是无法处理丢包

**3. 是否开启ack需要权衡**

- 开启ack，会降低RPS(Request Per Second)
- 局域网内，丢包是小概率事件，可以不开启
- 广域网，如果网络延时较高，不稳定，建议开启

### 四. 涉及到的API:

**1. UDP监听**

```typescript
/**
 * 监听传入的UDP连接。
 * @param {string} url - 要监听的URL，例如 "udp://127.0.0.1:8060"。
 * @param {{ frameLimit?: number, ack?: boolean }} [options] - 帧大小与可靠性选项。
 * @returns {this} 当前实例，用于链式调用。
 */
node.listen(url: string, options?: { frameLimit?: number, ack?: boolean }): this
```

**2. UDP连接**

```typescript
/**
 * 通过UDP协议连接到远端节点。
 * @param {string} url - 要连接的URL，例如 "udp://127.0.0.1:8060"。
 * @param {{ frameLimit?: number, ack?: boolean }} [options] - 帧大小与可靠性选项。
 * @returns {this} 当前实例，用于链式调用。
 */
node.attach(url: string, options?: { frameLimit?: number, ack?: boolean }): this
```

### 五. 可运行代码

完整示例代码，参见：<a href="../examples/01-basic/09-udp-protocol.mjs" target="_blank">09-udp-protocol.mjs</a>