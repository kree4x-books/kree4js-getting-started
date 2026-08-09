# 使用Socket.IO协议连接

> Created By [RV](mailto:rodney.vin@gmail.com), and licensed with Creative Commons "[CC BY-NC-ND 4.0](https://creativecommons.org/licenses/by-nc-nd/4.0/)"

**目的与场景**

在这一章，讲解**两个NodeJS节点**如何通过Socket.IO协议互联，实现双向RPC调用。

### 一. 概念

**Socket.IO 协议**

Socket.IO 是一个基于 WebSocket 构建的实时通信库，并内置多传输回退机制：

- 优先使用 WebSocket，连接失败时自动回退到 HTTP 长轮询（Long Polling）
- 提供房间（Room）、事件广播等高级模型
- 自带重连、心跳、二进制分帧等能力，连接管理开箱即用
- 浏览器兼容性极好，是浏览器与服务端实时通信的常用选择

与裸 WebSocket 相比，Socket.IO 牺牲部分性能换取更高的连接可靠性和广播能力。

**Socket.IO 在 Kree4X 中的角色**

Socket.IO 是第三方库，代码体积较大，不适合内建于 kree4n。

kree4n 不内置 Socket.IO 的 Provider，需要独立安装：

```bash
npm install @kree4js/socketio-listen @kree4js/socketio-attach
```

- 服务端由 `@kree4js/socketio-listen` 提供，客户端由 `@kree4js/socketio-attach` 提供
- **需要手动注册**：listen/attach 两侧都要注册对应的 Connection Provider
- Socket.IO URL 使用 `io://` 协议，与服务端的监听地址一一对应

### 二. 示例代码

在下边的示例中，我们将：

- nodeA作为Socket.IO服务器，监听端口8030，注册calc服务
- nodeB作为Socket.IO客户端，连接nodeA，注册str服务
- nodeB调用nodeA的calc服务
- nodeA调用nodeB的str服务（双向互调）

```javascript
import Kree4n from '@kree4js/kree4n'
import { SocketioListenConnectionProvider } from '@kree4js/socketio-listen'
import { SocketioAttachConnectionProvider } from '@kree4js/socketio-attach'

// ── Node A（Socket.IO服务器，注册calc服务） ─────────────
const nodeA = Kree4n.create('node-a', 'Socket.IO RPC server')
// SocketioListenConnectionProvider 需手动注册后才能识别 io:// 协议
nodeA.useConnectionProvider(new SocketioListenConnectionProvider())
nodeA.register('calc', {
  add (a, b) { return a + b },
  multiply (a, b) { return a * b }
})
nodeA.listen('io://127.0.0.1:8030')

// ── Node B（Socket.IO客户端，注册str服务） ─────────────
const nodeB = Kree4n.create('node-b', 'Socket.IO RPC client')
// SocketioAttachConnectionProvider 需手动注册后才能识别 io:// 协议
nodeB.useConnectionProvider(new SocketioAttachConnectionProvider())
nodeB.register('str', {
  echo (msg) { return `Echo: ${msg}` },
  greet (name) { return `Hello, ${name}! (via Socket.IO)` }
})
nodeB.attach('io://127.0.0.1:8030')

await nodeA.start()
await nodeB.start()

// node-b 调用 node-a 的 calc 服务
const calc = nodeB.service('calc')
const addResult = await calc.add(10, 20)      // 30
const mulResult = await calc.multiply(6, 7)   // 42

// node-a 调用 node-b 的 str 服务（双向）
const str = nodeA.service('str')
const echoResult = await str.echo('Socket.IO works!')  // "Echo: Socket.IO works!"
const greetResult = await str.greet('World')           // "Hello, World! (via Socket.IO)"
```

### 三. 须强调的细节

**需要手动安装并注册**

Socket.IO 是第三方库，体积较大，kree4n 不内置。使用前需要：

1. 安装独立包：`npm install @kree4js/socketio-listen @kree4js/socketio-attach`
2. 服务端注册 `SocketioListenConnectionProvider`，客户端注册 `SocketioAttachConnectionProvider`：

```javascript
import { SocketioListenConnectionProvider } from '@kree4js/socketio-listen'
import { SocketioAttachConnectionProvider } from '@kree4js/socketio-attach'

nodeA.useConnectionProvider(new SocketioListenConnectionProvider())
nodeB.useConnectionProvider(new SocketioAttachConnectionProvider())
```

不注册对应组件，`io://` 协议将无法被识别，listen/attach 会直接失败。

**传输回退**

Socket.IO 默认优先 WebSocket，不可用时回退到 HTTP 长轮询。在网络中 WebSocket 被防火墙拦截的环境下，这一机制能保证连接依然可用。

### 四. 涉及到的API:

**Socket.IO监听**

```typescript
/**
 * 监听传入的 Socket.IO 连接。
 *
 * 使用前需安装 @kree4js/socketio-listen 并注册 SocketioListenConnectionProvider：
 * node.useConnectionProvider(new SocketioListenConnectionProvider())
 *
 * @param {string} url - 要监听的 URL，例如 "io://127.0.0.1:8030"。
 * @returns {this} 当前实例，用于链式调用。
 */
node.listen(url: string): this
```

**Socket.IO连接**

```typescript
/**
 * 通过 Socket.IO 协议连接到远端节点。
 *
 * 使用前需安装 @kree4js/socketio-attach 并注册 SocketioAttachConnectionProvider：
 * node.useConnectionProvider(new SocketioAttachConnectionProvider())
 *
 * @param {string} url - 要连接的 URL，例如 "io://127.0.0.1:8030"。
 * @returns {this} 当前实例，用于链式调用。
 */
node.attach(url: string): this
```

### 五. 可运行代码

完整示例代码，参见：[11-socketio-protocol.mjs](../examples/01-basic/11-socketio-protocol.mjs)