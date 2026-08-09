# 使用WebSocket协议连接

> Created By [RV](mailto:rodney.vin@gmail.com), and licensed with Creative Commons "[CC BY-NC-ND 4.0](https://creativecommons.org/licenses/by-nc-nd/4.0/)"

**目的与场景**

在这一章，讲解**两个NodeJS节点**如何通过WebSocket协议互联，实现双向RPC调用。

### 一. 概念

**WebSocket 协议**

WebSocket 是建立在 TCP 之上的全双工通信协议：

- 通过 HTTP 握手升级（Upgrade: websocket），随后建立持久连接
- 全双工：客户端与服务端可同时双向收发消息
- 与普通 HTTP 轮询（xhr-poll / xhr-receive）不同，WebSocket 是一根常驻的双向管道
- 浏览器原生支持 WebSocket，是实现浏览器与服务端实时通信的基础

与 HTTP 的短连接 / 轮询相比，WebSocket 消除了请求-响应的一来一回开销，延迟更低，适合高频双向调用。

**WebSocket 在 Kree4X 中的角色**

- 服务端由 `http-listen` 内置提供：监听 `http://` 端口，自动升级 `/kreex/ws` 端点
- 客户端使用 `ws://` 协议 attach，kree4n 默认注册了 `WebSocketAttachConnectionProvider`，直接使用即可，不需要额外引入

### 二. 示例代码

在下边的示例中，我们将：

- nodeA作为HTTP服务器，监听端口8070，注册calc服务
- nodeB作为WebSocket客户端，连接nodeA，注册str服务
- nodeB调用nodeA的calc服务
- nodeA调用nodeB的str服务（双向互调）

```javascript
import Kree4n from '@kree4js/kree4n'

// ── Node A（WebSocket服务器，注册calc服务） ─────────────
const nodeA = Kree4n.create('node-a', 'WebSocket RPC server')
nodeA.register('calc', {
  add (a, b) { return a + b },
  multiply (a, b) { return a * b }
})
// WebSocket 服务端由 http-listen 内置，使用 http:// 监听即可
nodeA.listen('http://127.0.0.1:8070')

// ── Node B（WebSocket客户端，注册str服务） ─────────────
const nodeB = Kree4n.create('node-b', 'WebSocket RPC client')
// WebSocketAttachConnectionProvider 由 kree4n 默认注册，直接使用 ws:// 协议
nodeB.register('str', {
  echo (msg) { return `Echo: ${msg}` },
  greet (name) { return `Hello, ${name}! (via WebSocket)` }
})
nodeB.attach('ws://127.0.0.1:8070')

await nodeA.start()
await nodeB.start()

// node-b 调用 node-a 的 calc 服务
const calc = nodeB.service('calc')
const addResult = await calc.add(10, 20)      // 30
const mulResult = await calc.multiply(6, 7)   // 42

// node-a 调用 node-b 的 str 服务（双向）
const str = nodeA.service('str')
const echoResult = await str.echo('WebSocket works!')  // "Echo: WebSocket works!"
const greetResult = await str.greet('World')           // "Hello, World! (via WebSocket)"
```

### 三. 须强调的细节

**WebSocket Attach已内建**

kree4n 默认注册了 HTTP、TCP、UDP、HTTP2、WebSocket 等协议的处理组件，`ws://` 协议可直接使用。

```javascript
nodeB.attach('ws://127.0.0.1:8070')
```

**如何建立WebSocket Server**

Kree4N內建支持WebSocketListen。

WebSocket需要基于HTTP Server开放，所以对HTTP、WebSocket的支持是同一个`@kree4js/http-listen`插件提供的。

监听侧，Listen HTTP URL即可开放WebSocket协议：

- http://127.0.0.1:8080, 可以使用Attach ws://127.0.0.1:8080连接
- https://127.0.0.1:8080, 可以使用Attach wss://127.0.0.1:8080连接

**如何支持WebSocket Over TLS**

对端Listen HTTPs，然后使用wss协议连接即可。

例如：Attach wss://127.0.0.1:8080

### 四. 涉及到的API:

**WebSocket连接**

```typescript
/**
 * Attaches to a remote node via the WebSocket protocol.
 *
 * WebSocketAttachConnectionProvider 已由 kree4n 默认注册，无需手动引入：
 * node.attach('ws://127.0.0.1:8070')
 *
 * @param {string} url - The URL to attach to, e.g. "ws://127.0.0.1:8070".
 * @returns {this} The current instance for chaining.
 */
node.attach(url: string): this
```

### 五. 可运行代码

完整示例代码，参见：[10-websocket-protocol.mjs](../examples/01-basic/10-websocket-protocol.mjs)