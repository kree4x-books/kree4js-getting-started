# 使用HTTP协议连接

> Created By [RV](mailto:rodney.vin@gmail.com), and licensed with Creative Commons "[CC BY-NC-ND 4.0](https://creativecommons.org/licenses/by-nc-nd/4.0/)"

**目的与场景**

在这一章，讲解两个**NodeJS节点**如何通过HTTP协议互联，实现双向RPC调用。

### 一. 概念

**1. HTTP协议**

HTTP（HyperText Transfer Protocol）是最通用的网络协议，天然穿透防火墙和NAT，无需额外端口开放。

**2. listen/attach**

- `listen`：创建HTTP服务器，监听端口，等待客户端连接
- `attach`：以HTTP客户端身份连接到服务器

在HTTP协议中：

- 提供服务的节点调用 `listen('http://...')`，创建HTTP服务器
- 调用服务的节点调用 `attach('http://...')`，连接服务器

**3. 双向互调**

HTTP连接建立后，两端节点均可注册服务，也可调用对方的服务，实现双向RPC。

### 二. 示例代码

在下边的示例中，我们将：

- nodeA作为HTTP服务器，监听端口8040，注册calc服务
- nodeB作为HTTP客户端，连接nodeA，注册str服务
- nodeB调用nodeA的calc服务
- nodeA调用nodeB的str服务（双向互调）

```javascript
import Kree4n from '@kree4js/kree4n'

// Node A：HTTP服务器，注册calc服务
const nodeA = Kree4n.create('node-a', 'HTTP RPC server')
nodeA.register('calc', {
  add (a, b) { return a + b },
  multiply (a, b) { return a * b }
})
nodeA.listen('http://127.0.0.1:8040')

// Node B：HTTP客户端，注册str服务
const nodeB = Kree4n.create('node-b', 'HTTP RPC client')
nodeB.register('str', {
  echo (msg) { return `Echo: ${msg}` },
  greet (name) { return `Hello, ${name}! (via HTTP)` }
})
nodeB.attach('http://127.0.0.1:8040')

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
const echoResult = await str.echo('HTTP works!')   
// "Echo: HTTP works!"

const greetResult = await str.greet('World')        
// "Hello, World! (via HTTP)"
```

### 三. 须强调的细节

**1. 在使用node:http和node:https**

Kree4N内部使用了两个插件：`@kree4js/http-listen`和`@kree4js/http-attach`。

它们内部在使用NodeJS的http/https包。

NodeJS的http/https包，在建立连接后，是可以keep-alive，并且支持双向流式通信的。

”双向流式通信“，这一点有点意外，接受就好。

**2. HTTP连接是持久连接**

`http-attach` 内部使用HTTP持久连接（keep-alive），复用同一连接完成多次RPC调用，避免每次调用都建立新连接的开销。

**3. NodJS HTTP不是mono-frame的**

NodeJS HTTP协议下，使用流式通信，如果每次发送一个完整的帧，不能保证对端收到时完整的。

存在拖帧、粘帧问题，Kree4X在Transport层需要帧重组。

**4. 双向互调能力**

连接建立后，两端是对等的：

- 任意一端都可以注册服务
- 任意一端都可以调用对方注册的服务
- 不需要额外的反向连接

这一点，不同于传统的HTTP应用的单向Request-Response模型，了解就好。

### 四. 涉及到的API:

**1. HTTP监听**

```typescript
/**
 * 监听传入的连接。
 * @param {string} url - 要监听的URL，例如 "http://127.0.0.1:8040"。
 * @param {ConnectionOptions} [options] - 连接选项。
 * @returns {this} 当前实例，用于链式调用。
 */
node.listen(url: string, options?: ConnectionOptions): this
```

**2. HTTP连接**

```typescript
/**
 * 通过HTTP协议连接到HTTP服务器。
 * @param {string} url - 要连接的HTTP URL，例如 "http://127.0.0.1:8040"。
 * @returns {this} 当前实例，用于链式调用。
 */
node.attach(url: string): this
```

### 五. 可运行代码

完整示例代码，参见：<a href="../examples/01-basic/08-http-protocol.mjs" target="_blank">08-http-protocol.mjs</a>
