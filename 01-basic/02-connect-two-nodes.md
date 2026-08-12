# 连接两个节点

> Created By [RV](mailto:rodney.vin@gmail.com), and licensed with Creative Commons "[CC BY-NC-ND 4.0](https://creativecommons.org/licenses/by-nc-nd/4.0/)"

**目的与场景**

在这一章，讲解创建两个Kree4X服务节点，并通过网络连接，将它们连接起来。

### 一. 概念

**1. 网点：NetPoint**

传统的URL无法给定一个服务节点的地址；Net Point，才可以定义一个服务节点 。

简单讲，**Net Point = 方向模式 + 协议 + 地址 + 端口**。

Kree4X中，所有服务节点都是对等的，没有Client与Server之分。

例如: 给定http://localhost:8080，无法界定，是需要开启一个Http Server监听8080端口？还是需要开启一个Http通道连接至localhost的8080端口？

详细概念，参见[网点：Net Point](https://zhuanlan.zhihu.com/p/2033268200566170768)

**2. 连接: Connection**

Open一个NetPoint就得到一个连接。

我们所讲的连接，一个逻辑上抽象的概念，用以在Kree4X中定义和封装一个可以传输数据的通道。

例如，一个节点，可以**Listen**一个网络端口，等待其他节点连接。

一个节点，也可以**Attach**一个远程主机的端口，主动连接服务端。

**3. 通信协议**

Kree4N，默认内置支持多种通信协议：

- `http://` - HTTP， 同时支持Listen、Attach两种模式
- `http2://` - HTTP/2， 同时支持Listen、Attach两种模式
- `tcp://` - TCP， 同时支持Listen、Attach两种模式
- `udp://` - UDP， 同时支持Listen、Attach两种模式
- `ws://` - WebSocket， 同时支持Listen、Attach两种模式
- 允许自定义ConnectionProvider，支持更多通信协议

以下协议需要单独安装、手动注册ConnectionProvider（不内建于kree4n）：

- `io://` - Socket.IO， 同时支持Listen、Attach两种模式
- `kafka://` - Kafka， 仅限Attach模式

### 二. 连接两个节点

下边的示例代码，我们将：

- 创建两个节点
- 一个Listen TCP端口
- 一个Attach TCP端口
- 启动两个节点
- 等待节点连接完成，互相发现

```javascript
import Kree4n from '@kree4js/kree4n'

// 创建Node A
const nodeA = Kree4n.create('node-a')
nodeA.listen('tcp://127.0.0.1:8080') // Listen TCP

// 创建Node B
const nodeB = Kree4n.create('node-b')
nodeB.attach('tcp://127.0.0.1:8080') // Attach TCP

// 启动两个节点
await nodeA.start() // 优先启动Listen，可以避免Attach重试耗时
await nodeB.start()
// 提供了语法糖，检查两个节点间是否有已发现彼此
await nodeA.whenReady(nodeB, 5_000)// 5s超时
```

### 三. 须强调的细节

**1. 启动顺序**

启动顺序，不重要。

一个节点启动后，会按照设定的NetPoint信息，不断执行带退避策略的连接重试。

不过，Listen节点先启动，Attach节点后启动，可以避免无谓的重试耗时。

**2. 如何支持其他通信协议**

简单替换下url中的protocol即可。

服务层，对服务节点使用何种通信协议、使用几种通信协议无感。

只要节点间存在连接就好。

```javascript
nodeA.listen('udp://127.0.0.1:8081') // Listen UDP
nodeA.listen('http://127.0.0.1:8082') // Listen HTTP
nodeA.listen('http2://127.0.0.1:8083') // Listen HTTP2
nodeA.listen('ws://127.0.0.1:8084') // Listen WebSocket

nodeB.attach('udp://127.0.0.1:8081') // Attach UDP
nodeB.attach('http://127.0.0.1:8082') // Attach HTTP
nodeB.attach('http2://127.0.0.1:8083') // Attach HTTP2
nodeB.attach('ws://127.0.0.1:8084') // Attach WebSocket
```

**3. whenReady是必须的么？**

不是。

明确讲，**没有任何静态结构是必须的**。

节点的启动顺序也不是必须的，何时listen、何时attach也无关键要。

所有的Listen、Attach、各种通信协议可以动态启停，包括节点本身也可以动态启停。

动态性，是原生设计目标：

- 假定节点存在，直接连接就好
- 假定服务存在，直接调用就好
- 此次失败，下次也许就好了。

### **四. 涉及到的API**

**1. listen一个URL**

向Kree4X节点加入一个Listen模式的网点NetPoint。

如果节点已经启动，则会立即开始listen，试图打开连接。

```typescript
/**
  * 监听传入的连接。
  *
  * @param {string} url - 要监听的URL。
  * @param {ConnectionOptions} [options] - 连接选项。
  * @returns {this} 当前实例，用于链式调用。
  */
listen(url, options?): this;
```

**2. Attach一个URL**

向Kree4X节点加入一个Attach模式的网点NetPoint。

如果节点已经启动，则会立即开始Attach，试图打开连接。

```typescript
/**
 * 连接到远端节点。
 *
 * @param {string} url - 要连接的URL。
 * @param {ConnectionOptions} [options] - 连接选项。
 * @returns {this} 当前实例，用于链式调用。
 */
attach(url, options?): this;
```

**3. 启动一个节点**

```typescript
/**
 * 启动KreeX实例。
 *
 * @param {number} [timeout=30000] - 启动超时时间（毫秒）。
 * @returns {Promise<void>}
 */
start(timeout?: number): Promise<void>;
```

**4. 停止一个节点**

```typescript
/**
 * 停止KreeX实例。
 *
 * @returns {Promise<void>}
 */
stop(): Promise<void>;
```

### 五. 可运行代码

完整示例代码，参见：[02-connect-two-nodes.mjs](../examples/01-basic/02-connect-two-nodes.mjs)
