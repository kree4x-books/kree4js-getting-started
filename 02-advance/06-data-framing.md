# 数据分帧：分帧传送，避免帧溢出丢弃

> Created By [RV](mailto:rodney.vin@gmail.com), and licensed with Creative Commons "[CC BY-NC-ND 4.0](https://creativecommons.org/licenses/by-nc-nd/4.0/)"

**目的与场景**

在这一章，讲解Kree4X如何通过**数据分帧**（Data Framing），避免底层通信网络单数据包大小限制导致的通信异常。

Kree4X中，Transport层的数据包DataPack，**可以被切分**为多个数据帧DataFrame依次传送。

接收端自动将乱序多帧组装还原为DataPack，服务层、通信协议实现着，对此过程完全无感。

### 一. 概念

**1. 为什么需要分帧**

所有的通信网络，都存在一次传输时数据帧的上下限。

例如UDP，为避免IP分片，一次传送的UDP数据报应小于 `1500(MTU) - 20(IP头) - 8(UDP头) = 1472` 字节。

服务调用的参数、返回值，编码后，可能超出网络的单包上限。

Kree4X在框架层，Transport传输体系內建支持**数据分帧**，不对底层网络的能力做任何假设。

**2. 数据分帧：DataPack → 1..N个DataFrame**

首先，设定**帧最大值**（frameLimit）。

发送时DataPack会被**“切分”**为1..N个DataFrame依次传送。

接收端将收到的数据帧**“组装”**还原为完整的DataPack。

这个“**切分-组装**”的过程，被称为：数据分帧，Data Framing。

**3. frameLimit是什么？**

frameLimit是**连接（Connection/NetPoint）的能力限制**。

frameLimit，指明通过连接可发送接收的单个数据帧最大尺寸。

在设定NetPoint，listen或者attach URL时，可以指定对应的frameLimit。

- `listen(url, { frameLimit })`
- `attach(url, { frameLimit })`

不指定时，连接默认帧大小为 **100KB**。对于普通的RPC调用，此值足够单帧完成传送。

**4. frameLimit应该设为多少？**

取决于Connection采用的底层通信协议：

- **UDP**：最好不要超过1472字节这个基于标准以太网MTU的经验值（官方示例建议1152）。
- **TCP**：随意，TCP自身支持任意长度的流式传输。

过小的frameLimit，会导致普通的ServiceCall与ServiceCallResult被分割为多个帧顺序发送，这没有必要。

过大的frameLimit，如果网络传输时出现任何异常，一次会损失所有的数据。

### 二. 示例代码

在下边的示例中，我们将：

- node-a：**服务开放者**，注册 `data.fetch()`，返回300KB大payload
- node-b：**调用发起者**，调用 `fetch()` 接收完整数据

**1. 注册服务，设置帧大小**

```javascript
// node-a：注册data服务，返回300KB大payload
const PAYLOAD = 'x'.repeat(300 * 1024)
const nodeA = create('node-a')
nodeA.register('data', {
  fetch () { return PAYLOAD }
})

// node-a的Listen连接声明1024字节的帧能力，响应数据经此连接传送时按此切分
nodeA.listen('tcp://127.0.0.1:8071', { frameLimit: 1024 })

// node-b：调用发起者
const nodeB = create('node-b')
nodeB.attach('tcp://127.0.0.1:8071')
```

**2. 调用并观察分帧数**

通过监听Channel的 `frame-start` 事件，统计本节点发出的帧数：

```javascript
// 统计node-a发出的帧数（frame-start事件）
let frameCount = 0
nodeA.transport.on('channel-created', (channel) => {
  channel.on('frame-start', () => { frameCount++ })
})

const data = nodeB.service('data', { timeout: 10000 })
const value = await data.fetch()
// 300KB按1024切分 → 369帧；接收端自动组装，data完整还原
```

**3. 对比不同帧大小**

同样的300KB payload，不同frameLimit的帧数差异：

```javascript
// 默认（100KB/帧）：          收到307200字节，发出6帧
// frameLimit=1024（1KB/帧）：  收到307200字节，发出369帧
```

无论切分为多少帧，接收者接收的都是**完整组装还原**的数据。

如何分帧与组装，对服务层、通信协议实现层透明。

### 三. 须强调的细节

**1. frameLimit是连接的能力限制**

frameLimit决定的是"某条连接能承载的帧大小"，与发送侧、接收侧的角色无关。

数据流经此条连接，即按该连接的能力进行切分。

**2. 分帧对服务层、通信协议实现层透明**

分帧与组装全部在Transport/Connection层完成，业务代码（服务方法、服务调用）完全感知不到帧的存在，也无须做任何处理。

**3. 默认帧大小100KB**

连接默认 `frameLimit=100KB`。

多数业务payload远小于此值，分帧不会发生；只有超出帧大小时才切分。

**4. 分帧是"时间换空间"**

分帧后，一个大payload变为多个帧顺序发送，耗时增加——以更多的耗时，换取大型数据传送的可行性与可靠性。

**5. 帧中继与分帧的关系**

转发节点（proxyMode）转发帧时，若转发连接的frameLimit小于被转发帧大小，如果有多个连接可选，排除掉此转发连接诶，可避免数据帧的再次重组->切分。

通过 **FrameLimitFilterPolicy** 可设定转发过滤策略，排除特定连接，参见ForwardPolicy一章的内建策略。

### 四. 涉及到的API

**1. 设定帧大小：listen/attach的ConnectionOptions.frameLimit参数**

```typescript
/**
 * 监听指定URL，可设置连接选项。
 *
 * @param {string} url - 监听地址。
 * @param {ConnectionOptions} [options] - 连接选项。
 * @returns {this} 当前节点，支持链式。
 */
listen(url, options?: ConnectionOptions): this

/**
 * 连接到远端节点，可设置连接选项。
 *
 * @param {string} url - 远端地址。
 * @param {ConnectionOptions} [options] - 连接选项。
 * @returns {this} 当前节点，支持链式。
 */
attach(url, options?: ConnectionOptions): this

// frameLimit为连接选项之一，单位：字节
type ConnectionOptions = {
  frameLimit?: number
}
```

### 五. 可运行代码

完整示例代码，参见：<a href="../examples/02-advance/06-data-framing.mjs" target="_blank">06-data-framing.mjs</a>