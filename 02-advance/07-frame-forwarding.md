# 帧中继：开启节点数据转发，支持节点间接通信

> Created By [RV](mailto:rodney.vin@gmail.com), and licensed with Creative Commons "[CC BY-NC-ND 4.0](https://creativecommons.org/licenses/by-nc-nd/4.0/)"

**目的与场景**

在这一章，讲解如何**开启节点的数据帧中继**（Frame Forwarding），让无法直连的节点，经中继节点转发，实现**间接通信**。

### 一. 概念

**1. 数据帧中继：Frame Forwarding**

开启帧中继的节点，会转发"目的节点ID不是自身"的数据帧。

中继节点（同样以 `proxyMode` 开启）自身可以是**多协议桥接器**：同时使用多种通信协议连接不同的节点，把一侧协议网络收到的帧，转发到另一侧协议网络。

如 [通信网格：Net Grid](https://zhuanlan.zhihu.com/p/2034950270879318909) 所述，通过帧中继，采用不同通信协议的多个网络互相连接，形成**网格**（Net Grid），网格中任意两个节点都能建立通信链路。

**2. 默认关闭，安全考虑**

帧中继**默认是关闭的**，单纯出于安全考虑。

"默认配置即风险"：如果默认启用帧中继，绝大部分用户一定会无意间将内部的服务节点暴露于外部用户之前，从而导致非预期的行为。

只有如下场景下，开启帧中继才是合适的：

- 使用一个节点，作为 **API网关**
- **内部使用**，不开放给外部用户，组建通信网格
- 明确的、要开放整个微服务网络给所有用户

**3. 如何开启**

创建节点时设置 `transport: { proxyMode: true }` 即开启帧中继：

```javascript
const proxy = create('proxy', undefined, { transport: { proxyMode: true } })
```

**4. 防止转发风暴**

网格中每个节点间可能存在不只一条可达链路，且可能形成环路。不受抑制的帧中继一定会导致毁灭性的**数据中继风暴**。系统使用多种机制抑制：

- **HOPs计数**：DataFrame的HOPs值减至0时，立即丢弃。
- **环路检测**：若当前节点ID已出现在HOP列表中，则丢弃该数据帧，打破环路。
- **滤重**：若DataFrame存在于"近期已处理名单"中，则直接丢弃，避免重复处理。

### 二. 示例代码

在下边的示例中，我们将：

- node-c：**服务开放者**，仅支持UDP，注册 `greet.hello()` 与 `hello.hi()` 的被调用方
- proxy：**中继节点**，开启proxyMode，同时桥接TCP与UDP
- node-a：**调用发起者**，仅支持TCP，注册 `hello.hi()`

node-a 与 node-c 无共同通信协议，无法直连，全部经proxy帧中继互通。

**1. 搭建拓扑**

```javascript
// node-c：仅支持UDP的服务开放者，注册greet服务
const nodeC = create('node-c')
nodeC.register('greet', {
  hello (name) { return `Hello, ${name}! (from node-c via UDP)` }
})
// UDP建议frameLimit=1152，需ack保证可靠
nodeC.listen('udp://127.0.0.1:8082', { frameLimit: 1152, ack: true })

// proxy：帧中继节点，桥接TCP与UDP
const proxy = create('proxy', undefined, { transport: { proxyMode: true } })
proxy.attach('udp://127.0.0.1:8082', { frameLimit: 1152, ack: true })
proxy.listen('tcp://127.0.0.1:8081', { frameLimit: 1152 })

// node-a：仅支持TCP的调用发起者，注册hello服务
const nodeA = create('node-a')
nodeA.register('hello', {
  hi (name) { return `Hi, ${name}! (from node-a via TCP)` }
})
nodeA.attach('tcp://127.0.0.1:8081', { frameLimit: 1152 })
```

**2. TCP侧 → UDP侧：经proxy帧中继**

```javascript
// node-a(TCP)调用node-c(UDP)的greet服务，经proxy帧中继
const greet = nodeA.service('greet')
await greet.hello('World')
// Hello, World! (from node-c via UDP)
```

**3. UDP侧 → TCP侧：同样经proxy帧中继**

```javascript
// node-c(UDP)调用node-a(TCP)的hello服务，同样经proxy帧中继
const hello = nodeC.service('hello')
await hello.hi('World')
// Hi, World! (from node-a via TCP)
```

### 三. 须强调的细节

**1. 转发要求:目的ID不是自身**

节点只转发"目的节点ID不是自身"的数据帧。

发给自己的帧、自己的应答帧，均不会被中继。

**2. 开启帧中继的条件**

创建节点时通过 `transport: { proxyMode: true }` 设置。开启后默认进入 **AllowAll** 转发模式。

**3. 默认的转发策略:AllowAll**

开启帧中继后，默认转发策略是 **AllowAll**，允许转发所有帧。

如果需要精确控制转发内容（如只放行业务调用帧），使用 **ForwardPolicy** 定制转发策略，见下一章。

**4. 异构间接通信的前提**

中继节点必须同时具备两侧的通信协议连接（如 `attach(udp://...)` + `listen(tcp://...)`），才能桥接异构网络。

UDP连接建议设置 `frameLimit: 1152` 并开启 `ack: true` 保证可靠传输，见数据分帧一章。

**5. 帧中继≠动态直连**

帧中继是间接通信。如果两个节点协议兼容且频繁通信，系统可动态建立**直接连接**提升效率（动态直连是后续章节的内容）。

### 四. 涉及到的API

**1. 创建开启帧中继的节点**

```typescript
/**
 * 创建一个启用proxyMode的KreeX实例。
 * @param {string} name - 节点名称。
 * @param {string} [description] - 节点描述。
 * @param {{ transport?: { proxyMode?: boolean } }} [options] - 传输层选项。
 */
Kree4n.create(name: string, description?: string, options?: { transport?: { proxyMode?: boolean } }): KreeX
```

**2. 帧中继模式与选项**

```typescript
// 创建节点时开启帧中继
type TransportOptions = {
  proxyMode: boolean // default false
}

// 开启后默认进入AllowAll转发模式，可用forwardDenyAll()/forwardAllowAll()切换
// （详见ForwardPolicy一章）
```

### 五. 可运行代码

完整示例代码，参见：[07-frame-forwarding.mjs](../examples/02-advance/07-frame-forwarding.mjs)