# 使用Kafka协议连接

> Created By [RV](mailto:rodney.vin@gmail.com), and licensed with Creative Commons "[CC BY-NC-ND 4.0](https://creativecommons.org/licenses/by-nc-nd/4.0/)"

**目的与场景**

在这一章，讲解**两个NodeJS节点**如何通过Kafka broker建立通信通道，实现双向RPC调用。

### 一. 概念

**1. Kafka**

Kafka不是一个"点对点"的连接协议。

节点之间**没有直接连接**，所有消息都经过Kafka broker中转。

Kree4X仅把Kafka作为中转数据的消息总线，使用Kafka在多个节点间可靠的转发消息。

使用Kree4X的DSE(分布式EventEmitter)机制时，Kafka可作为一种可靠消息信道，保证DSE Event的最少一次到达。

**2. 对Kafka Server的要求**

**使用本示例前，需要一个可用的Kafka broker**（示例本身只作为客户端连接，不内嵌、不启动Kafka）：

| 要求 | 说明 |
|------|------|
| Kafka版本 | 2.x或3.x均可 |
| broker地址 | 示例默认 `127.0.0.1:8092`，可按需修改为 `kafka://broker-host:port` |
| 端口可达 | 客户端需能TCP访问broker端口 |
| topic `kree4x` | **必须预先创建**（详见下文"topic要求"） |

**3. Topic要求**

默认使用Topic：`kree4x`

- 所有节点订阅 `kree4x`，消息通过此topic收发。
- Topic必须在broker上预先创建，否则attach会失败

创建Topic的命令：

```bash
kafka-topics.sh --bootstrap-server 127.0.0.1:8092 \
  --create --topic kree4x --partitions 1 --replication-factor 1
```


### 二. 示例代码

在下边的示例中，我们将（请先确保Kafka broker已启动且 `kree4x` topic已创建）：

- nodeA作为Kafka客户端，连接broker，注册calc服务
- nodeB作为Kafka客户端，连接同一broker，注册str服务
- nodeB调用nodeA的calc服务
- nodeA调用nodeB的str服务（双向互调）

```javascript
import Kree4n from '@kree4js/kree4n'
import { KafkaAttachConnectionProvider } from '@kree4js/kafka-attach'

// ── 注册Kafka连接提供者（kree4n默认不包含） ─────────────
const kafkaProvider = new KafkaAttachConnectionProvider()

// ── Node A（Kafka客户端，注册calc服务） ─────────────
const nodeA = Kree4n.create('node-a', 'Kafka RPC server')
nodeA.useConnectionProvider(kafkaProvider)
nodeA.register('calc', {
  add (a, b) { return a + b },
  multiply (a, b) { return a * b }
})
// kafka-attach是attach-only，所有节点都以client身份连接broker
nodeA.attach('kafka://127.0.0.1:8092')

// ── Node B（Kafka客户端，注册str服务） ─────────────
const nodeB = Kree4n.create('node-b', 'Kafka RPC client')
nodeB.useConnectionProvider(kafkaProvider)
nodeB.register('str', {
  echo (msg) { return `Echo: ${msg}` },
  greet (name) { return `Hello, ${name}! (via Kafka)` }
})
nodeB.attach('kafka://127.0.0.1:8092')

await nodeA.start()
await nodeB.start()

// 等待KreeX Grid通过Kafka发现对方节点就绪
await nodeA.whenReady(nodeB, 5000)
await nodeB.whenReady(nodeA, 5000)

// node-b调用node-a的calc服务
const calc = nodeB.service('calc')
const addResult = await calc.add(10, 20)      // 30
const mulResult = await calc.multiply(6, 7)   // 42

// node-a调用node-b的str服务（双向）
const str = nodeA.service('str')
const echoResult = await str.echo('Kafka works!')  // "Echo: Kafka works!"
const greetResult = await str.greet('World')       // "Hello, World! (via Kafka)"
```

## 三、须强调的细节

**1. KafkaAttachConnectionProvider需手动注册**

安装`@kree4js/kafka-attach`包。

然后使用kree4x.useConnectionProvider()注册。

```javascript
import { KafkaAttachConnectionProvider } from '@kree4js/kafka-attach'
node.useConnectionProvider(new KafkaAttachConnectionProvider())
```

**2. Attach-only，没有listen**

Kree4X使用Kafka时， 没有Listen模式，由Kree4X来管理Kafka Server是错误的。

所有Kree4X节点，都是Kafka的生产者/消费者（client）。

Kree4X节点通过 `attach`模式 连接broker，节点间通过topic交换消息。

**3. 默认TopicMode：broadcast**

使用唯一的“`kree4x`”Topic，进行broadcast消息广播。

所有的Kree4X节点，都使用此topic进行数据交换。本质是一种广播模式，所有的节点都会收到数据。

如果当前节点不需要处理数据，则丢弃。

```
nodeB.attach('kafka://127.0.0.1:8092', { topicMode: 'broadcast' })
```

**4. TopicMode：dynamic模式，**

允许各个Kree4X创建自己的Kafka Topic

```
node.attach('kafka://127.0.0.1:8092', { topicMode: 'dynamic' })
```

需要Kafka Server开放“`allowAutoTopicCreation`”选项。

生成环境中，此要求有些不太合理。

**5. dynamic模式时，Grid发现需要时间**

创建topic，开始监听，数据到来。

dynamic模式时，各个Kree4X节点的互相发现比较缓慢，节点启动后，如果立即进行服务调用，可能因节点尚未互相发现而找不到目标服务，而出现临时失败。

## 四、涉及到的API:

**1. Kafka连接**

```typescript
/**
 * 通过Kafka协议连接到远端节点。
 *
 * 使用前需在节点上注册KafkaAttachConnectionProvider：
 * node.useConnectionProvider(new KafkaAttachConnectionProvider())
 *
 * @param {string} url - Kafka broker的URL，例如 "kafka://127.0.0.1:8092"。
 * @param {{ topicMode?: 'broadcast'|'dynamic' }} [options] - 主题模式。
 *   'broadcast': 所有节点共享topic 'kree4x'（默认，topic需预创建）
 *   'dynamic':   每节点私有topic 'kree4x-{nodeId}'，允许自动创建
 * @returns {this} 当前实例，用于链式调用。
 */
node.attach(url: string, options?: { topicMode?: 'broadcast'|'dynamic' }): this
```

## 五、可运行代码

完整示例代码，参见：<a href="../examples/01-basic/12-kafka-protocol.mjs" target="_blank">12-kafka-protocol.mjs</a>