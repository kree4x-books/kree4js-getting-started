# 间接服务调用

> Created By [RV](mailto:rodney.vin@gmail.com), and licensed with Creative Commons "[CC BY-NC-ND 4.0](https://creativecommons.org/licenses/by-nc-nd/4.0/)"

**目的与场景**

在这一章，讲解两个无法直连的节点，如何通过中心节点（Hub）进行间接服务调用。

### 一. 概念

**星型拓扑（Hub-Leaf）**

在星型拓扑中，所有外围节点（Leaf）只与中心节点（Hub）直连，外围节点之间无法直连。

消息流向：`Leaf → Hub → Leaf`

**间接调用**

当两个Leaf节点无法直连时，可以通过Hub节点转发消息，实现间接服务调用。

Kree4X内置了消息转发机制，只需在Hub节点开启`proxyMode`，即可自动转发消息。

### 二. 星型拓扑间接调用

在下边的示例中，我们将：

- 创建一个Hub节点，开启转发模式
- 创建两个Leaf节点，都连接到Hub
- Leaf1注册greet服务
- Leaf2调用greet服务，经Hub转发到Leaf1

```javascript
import Kree4n from '@kree4js/kree4n'

// Hub节点：开启转发模式，监听端口
const hub = Kree4n.create('hub', undefined, {
  transport: { proxyMode: true }
})
hub.listen('tcp://127.0.0.1:8010')

// Leaf1：注册服务，连接到Hub
const leafNode1 = Kree4n.create('leaf-1')
leafNode1.register('greet', {
  hello (name) { return `Hello, ${name}! (from leaf-1)` }
})
leafNode1.attach('tcp://127.0.0.1:8010')

// Leaf2：连接到Hub，调用服务
const leafNode2 = Kree4n.create('leaf-2')
leafNode2.attach('tcp://127.0.0.1:8010')

await hub.start()
await leafNode1.start()
await leafNode2.start()

// Leaf2调用Leaf1的greet服务，经Hub转发
const greet = leafNode2.service('greet')
const result = await greet.hello('World')
// result: "Hello, World! (from leaf-1)"
```

### 三. 须强调的细节

**关于拓扑结构**

拓扑结构，一点都不重要。

示例中，使用的是星型拓扑，实际只要两个节点间存在可达链路就行。

链式连接，也能工作。

间接连接节点间，通信协议不同，也能工作。

所以，我们把传输层叫作Grid，通信网格，而不是通信网络。

详情，参考：[通信网格：Net Grid](https://zhuanlan.zhihu.com/p/2034950270879318909)

**proxyMode**

在Hub节点创建时设置 `transport: { proxyMode: true }`，开启消息转发模式。

开启后，Hub会自动将收到的消息转发给目标节点。

数据转发，术语”数据帧中继“，默认是关闭的。原因，”默认配置即风险“。

默认配置，是一个巨大的惯性陷阱。如果，默认启用帧中继的话，绝大部分用户，一定会无意间将内部的服务节点暴露于外部用户之前，从而导致非预期的行为。

详情，参考：[https://zhuanlan.zhihu.com/p/2036008614192735404](https://zhuanlan.zhihu.com/p/2036008614192735404)

**转发策略（ForwardPolicy）**

系统提供了API，允许定制数据转发策略。

这是中高级特性，后续章节会展开详细讲解。

此处，只需记住：默认的转发策略是”AllowAll模式“，允许转发所有消息

### 四. 涉及到的API:

**创建带转发模式的节点**

```typescript
/**
 * Creates a KreeX instance with proxyMode enabled.
 * @param {string} name - The node name.
 * @param {string} [description] - The node description.
 * @param {{ transport?: { proxyMode?: boolean } }} [options] - Transport options.
 */
Kree4n.create(name: string, description?: string, options?: { transport?: { proxyMode?: boolean } }): KreeX
```

### 五. 可运行代码

完整示例代码，参见：[06-indirect-call.mjs](../examples/01-basic/06-indirect-call.mjs)
