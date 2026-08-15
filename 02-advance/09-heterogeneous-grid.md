# 异构组网：多通信协议融合，组建通信网格

> Created By [RV](mailto:rodney.vin@gmail.com), and licensed with Creative Commons "[CC BY-NC-ND 4.0](https://creativecommons.org/licenses/by-nc-nd/4.0/)"

**目的与场景**

在这一章，讲解如何将采用**不同通信协议**的多个网络互相连接，融合成一张**通信网格**（Net Grid），使网格中任意两个节点，无论身处哪个协议网络，都能建立通信链路、互相调用服务。

### 一. 概念

**1. 传输网络：Network**

将采用**同种通信协议**的各个节点互相连接，得到一个传输网络（Network）。

以TCP网络为例：一个节点Listen某个地址:端口，其它节点以Attach方式连接到该地址:端口。

这组成了一张TCP网络。

**2. 通信网格：Net Grid**

多张同构、异构网络互相连接，组成的网格，称之为通信网格。

在网格中：

- 节点采用多种通信协议
- 一个节点可同时属于多个网络
- 节点间**可动态协商**建立新链路，也可动态退出
- **任意两个节点都可通信**，它们之间没有直连协议时，其他节点转发亦可到达

详情，参阅： [通信网格：Net Grid](https://zhuanlan.zhihu.com/p/2034950270879318909) 

**3. 多协议融合，是网格的基本形态**

生产系统中，针对不同的场景，我们经常采用不同的通信协议：

- 内部微服务之间，**TCP**网络可靠、低延迟
- 与浏览器打交道，不得不采用**HTTP** / **WebSocket** 
- 消息推送、实时同步，采用**UDP** ，低开销

这些异构网络，经**桥接节点**（开启了proxyMode）彼此连通，即可融合成一张统一的通信网格。

**4. 网格对于使用者是透明的**

对于使用KreeX的对象，网格是透明的：

- 发起到某个节点的调用，无需关心对方身处哪个协议网络
- 跨网络的调用，自动经桥接节点转发，无需任何特殊处理
- 网格对有共同协议的节点，可经协商、自动建立直接连接，动态路由

### 二. 示例代码

在下边的示例中，我们将组建一张由 **TCP网络** 与 **UDP网络** 融合的通信网格：

- node-a：**TCP网络**节点，注册 `calc` 服务
- node-b：**桥接节点**，同时连接TCP与UDP，开启proxyMode，将两个网络融合成一张网格，注册 `str` 服务
- node-c：**UDP网络**节点，注册 `greet` 服务

node-a 与 node-c 无共同通信协议，但因同属一张网格，可以**跨协议互相调用**。

**1. 搭建拓扑**

```javascript
// node-a：TCP网络节点，注册calc服务
const nodeA = create('node-a', 'TCP service node')
nodeA.register('calc', {
  add (a, b) { return a + b },
  multiply (a, b) { return a * b }
})
// node-a：TCP网络, frameLimit不是必须，保持多节点一致可避免重新分帧
nodeA.listen('tcp://127.0.0.1:8091', { frameLimit: 1152 })

// node-b：桥接节点，同时连接TCP与UDP，开启proxyMode跨网络转发
const nodeB = create('node-b', 'UDP bridge node', { transport: { proxyMode: true } })
nodeB.register('str', {
  echo (msg) { return `Echo: ${msg}` },
  greet (name) { return `Hello, ${name}! (from node-b)` }
})
// node-b：TCP连接至node-a
nodeB.attach('tcp://127.0.0.1:8091', { frameLimit: 1152 })
// node-b: UDP监听，注意“ack: true”开启了KreeX应用层可靠UDP通信
nodeB.listen('udp://127.0.0.1:8092', { frameLimit: 1152, ack: true })

// node-c：UDP网络节点，注册greet服务
const nodeC = create('node-c', 'UDP caller node')
nodeC.register('greet', {
  hello (name) { return `Hello, ${name}! (from node-c)` }
})
// node-c: UDP连接node-b，注意“ack: true”开启了KreeX应用层可靠UDP通信
nodeC.attach('udp://127.0.0.1:8092', { frameLimit: 1152, ack: true })
```

**2. 等待网格互相发现**

节点启动后，需要时间完成网格发现。`whenReady()` 等待目标节点在当前节点生成为止：

```javascript
await nodeC.whenReady(nodeB.id)
await nodeA.whenReady(nodeB.id)
await nodeA.whenReady(nodeC.id)
```

**3. 跨协议调用：node-c(UDP) → node-a(TCP)**

UDP网络中的node-c，调用TCP网络中的node-a的 `calc` 服务，经桥接节点node-b转发：

```javascript
const calc = nodeC.service('calc')
await calc.add(10, 20)       // 30
await calc.multiply(6, 7)    // 42
```

**4. 同协议调用：node-c(UDP) → node-b(UDP)**

node-c 直接调用同处UDP网络的node-b的 `str` 服务：

```javascript
const str = nodeC.service('str')
await str.greet('World')     // Hello, World! (from node-b)
```

**5. 反向跨协议调用：node-a(TCP) → node-c(UDP)**

TCP网络中的node-a，调用UDP网络中的node-c的 `greet` 服务：

```javascript
const greet = nodeA.service('greet')
await greet.hello('World')   // Hello, World! (from node-c)
```

### 三. 须强调的细节

**1. 桥接节点必须同时具备两侧协议连接**

桥接节点必须同时连接两侧的协议网络（如 `attach(tcp://...)` + `listen(udp://...)`）。

同时，开启 `transport: { proxyMode: true }`，才能跨网络转发。

`proxyMode: true`，详见《帧中继：开启节点数据转发，支持节点间接通信》。

**2. UDP网络建议可靠传输**

UDP网络建议设置 `frameLimit: 1152` 并开启 `ack: true`，保证跨网络的调用可靠传输。

Kree4X，在Transport层，內建了DataFrame的Ack机制，支持DataFrame数据帧的收发确认机制。

此Ack机制，与通信协议无关，在任何通信协议上，都可开启。

**3. 等待网格发现完成**

节点启动后，网格的互相发现需要时间。

示例中，使用 `whenReady()` 等待目标节点可见，避免过早发起调用而失败。

注意：

- whenReady机制，**仅在示例中使用**，控制示例按照我们期望的时序执行。

- **生产环境**，网络、服务都是动态的，**不需要**此种静态机制。
- 生产环境，我们也无从得知远端节点的id，whenReady也无从调用。

**4. 网格中继≠直连**

跨协议调用经桥接节点转发，属于间接通信。

若两个节点协议兼容且频繁通信，Kree4X支持动态协商，建立直连。

系统可动态建立**直接连接**，从而规避间接转发的低效，提高通信效率。

下一章《动态链路：开启通信协商，支持动态链路直连与断线重连》，会讨论此问题。

### 四. 涉及到的API

**1. 监听指定URL**

```typescript
/**
 * 监听指定URL，可设置连接选项。
 * URL的协议部分，决定本节点加入哪种协议网络。
 *
 * @param {string} url - 监听地址。
 * @param {ConnectionOptions} [options] - 连接选项。
 * @returns {this} 当前节点，支持链式。
 */
listen(url, options?: ConnectionOptions): this
```

**2. 连接到远端节点**

```typescript
/**
 * 连接到远端节点，可设置连接选项。
 * URL的协议部分，决定本节点加入哪种协议网络。
 *
 * @param {string} url - 远端地址。
 * @param {ConnectionOptions} [options] - 连接选项。
 * @returns {this} 当前节点，支持链式。
 */
attach(url, options?: ConnectionOptions): this
```

**3. 连接选项：ConnectionOptions**

```typescript
type ConnectionOptions = {
  frameLimit?: number    // 连接（NetPoint）可承载的单个数据帧最大尺寸，默认100KB
  ack?: boolean          // 是否开启DataFrame报文确认，保证可靠传输
  maxSender?: number     // 最大并发发送通道数
  maxInChannel?: number  // 最大接收通道数
  maxOutChannel?: number // 最大发送通道数
  openTimeout?: number   // 连接打开超时（毫秒）
}
```

UDP网络建议设置 `frameLimit: 1152`（受MTU限制），如需可靠通信可开启 `ack: true` 报文确认。

**4. 节点选项：TransportOptions**

```typescript
// 创建节点时开启帧中继，跨网络转发
type TransportOptions = {
  proxyMode: boolean // default false
}

// 桥接节点必须开启，才能跨网络转发
const nodeB = create('node-b', 'UDP bridge node', { transport: { proxyMode: true } })
```

详见《帧中继：开启节点数据转发，支持节点间接通信》。

### 五. 可运行代码

完整示例代码，参见：<a href="../examples/02-advance/09-heterogeneous-grid.mjs" target="_blank">09-heterogeneous-grid.mjs</a>