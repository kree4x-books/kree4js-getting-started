# 使用HTTP2协议连接

> Created By [RV](mailto:rodney.vin@gmail.com), and licensed with Creative Commons "[CC BY-NC-ND 4.0](https://creativecommons.org/licenses/by-nc-nd/4.0/)"

**目的与场景**

在这一章，讲解**两个NodeJS节点**如何通过HTTP/2协议互联，实现双向RPC调用。

### 一. 概念

**1. HTTP/2协议**

HTTP/2是HTTP的下一代协议，建立在TLS之上，核心特性是多路复用（Multiplexing）：单个连接内并行传输多个请求/响应，互不阻塞。

RFC 7540，HTTP/2包括：

- h2 — HTTP/2 over TLS（ALPN协商）
- h2c — HTTP/2 run over cleartext TCP，明文传输、不使用TLS

实际部署中h2c几乎无人使用，浏览器只支持h2，主流服务器默认禁h2c。

新版RFC 9113（取代RFC 7540）已弃用h2c的Upgrade用法，并将h2c Upgrade token标记为obsolete。

**2. TLS证书**

我们所讲的HTTP/2，指代的是”HTTP/2 over TLS“，服务端必须提供证书。

示例中使用openssl临时生成自签证书，客户端用 `rejectUnauthorized: false` 跳过证书校验。

### 二. 示例代码

在下边的示例中，我们将：

- nodeA作为HTTP/2服务器，监听端口8050，注册calc服务
- nodeB作为HTTP/2客户端，连接nodeA，注册str服务
- nodeB调用nodeA的calc服务
- nodeA调用nodeB的str服务（双向互调）

```javascript
import Kree4n from '@kree4js/kree4n'

// ── 生成自签证书（HTTP/2 over TLS需要证书） ──────
const { key, cert, tempDir } = createSelfSignedCerts()

// ── Node A（HTTP/2服务器，注册calc服务） ─────────
const nodeA = Kree4n.create('node-a', 'HTTP/2 RPC server')
nodeA.register('calc', {
  add (a, b) { return a + b },
  multiply (a, b) { return a * b }
})
// 证书 / TLS是强制的
nodeA.listen('https2://127.0.0.1:8050', { key, cert })

// ── Node B（HTTP/2客户端，注册str服务） ─────────
const nodeB = Kree4n.create('node-b', 'HTTP/2 RPC client')
nodeB.register('str', {
  echo (msg) { return `Echo: ${msg}` },
  greet (name) { return `Hello, ${name}! (via HTTP/2)` }
})
// 自签名证书
nodeB.attach('https2://127.0.0.1:8050', { rejectUnauthorized: false })

await nodeA.start()
await nodeB.start()

// node-b调用node-a的calc服务
const calc = nodeB.service('calc')
const addResult = await calc.add(10, 20)      
// 30

const mulResult = await calc.multiply(6, 7)   
// 42

// node-a调用node-b的str服务（双向）
const str = nodeA.service('str')

const echoResult = await str.echo('HTTP/2 works!')   
// "Echo: HTTP/2 works!"

const greetResult = await str.greet('World')          
// "Hello, World! (via HTTP/2)"

```

### 三. 须强调的细节

**1. 同时支持了h2和h2c**

我们同时支持了h2和h2c，使用protocol进行区分：

- h2: https2://……
- h2c: http2://……

**2. 与HTTP示例基本相同，除了协议是"https2"**

Kree4X的服务与底层通信是无关的。

同样一个服务，既可以跑在HTTP网络，也可以无差别地运行在HTTP/2网络。

源码中，把url中的http替换为https2即可。

**3. HTTP2强制要求证书与TLS**

示例中，创建了自签名证书，并且配置了SAN ，让自签证书对localhost/127.0.0.1生效。

生产环境，您需要获取，并配置受信任的CA证书。

**4. 浏览器HTTP2**

浏览器JS无法获取HTTP/2 session控制权，访问一个HTTP/2的Web Server，实际采用什么协议，是JS无法控制的。

主流浏览器对HTTP/2的特性支持，不尽相同。

浏览器中使用Kree4B，可以连接一个http2 Server，当无法协商建立http2连接时，会自动fallback为HTTP/1.1。

**5. 一条stream = 一个channel**

HTTP/2的每次RPC调用对应一条双向stream，一条stream即一个传输通道；同一session下的多条stream并行复用同一TCP连接，互不阻塞，无需WebSocket升级。

**6. 双向互调能力**

与HTTP/1.1相同，连接建立后两端对等，任意一端都可注册服务和调用对方服务。

### 四. 涉及到的API:

**1. HTTPS2监听**

```typescript
/**
 * 监听传入的HTTPS2连接。
 * @param {string} url - 要监听的URL，例如 "https2://127.0.0.1:8050"。
 * @param {{ key: Buffer|string, cert: Buffer|string }} options - TLS证书选项。
 * @returns {this} 当前实例，用于链式调用。
 */
node.listen(url: string, options?: { key?, cert? }): this
```

**2. HTTPS2连接**

```typescript
/**
 * 通过HTTPS2协议连接到远端节点。
 * @param {string} url - 要连接的URL，例如 "https2://127.0.0.1:8050"。
 * @param {{ rejectUnauthorized?: boolean }} [options] - TLS连接选项。
 * @returns {this} 当前实例，用于链式调用。
 */
node.attach(url: string, options?: { rejectUnauthorized?: boolean }): this
```

### 五. 可运行代码

完整示例代码，参见：<a href="../examples/01-basic/08-http2-protocol.mjs" target="_blank">08-http2-protocol.mjs</a>