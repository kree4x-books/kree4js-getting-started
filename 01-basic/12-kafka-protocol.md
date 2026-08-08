# 使用Kafka协议连接

> Created By [RV](mailto:rodney.vin@gmail.com), and licensed with Creative Commons "[CC BY-NC-ND 4.0](https://creativecommons.org/licenses/by-nc-nd/4.0/)"

**目的与场景**

在这一章，讲解**两个NodeJS节点**如何通过 Kafka broker 建立通信通道，实现双向RPC调用。

### 一. 概念

与之前的章节不同，Kafka 不再是一个"点对点"的连接协议。节点之间**没有直接连接**，所有消息都经过 Kafka broker 中转。Kree4X 把 Kafka 当作一根"哑管道"（dumb pipe）：消息是原始的二进制帧，路由与过滤由 Kree4X 上层完成。

**对 Kafka Server 的要求**

**使用本示例前，需要一个可用的 Kafka broker**（示例本身只作为客户端连接，不内嵌、不启动 Kafka）：

| 要求 | 说明 |
|------|------|
| Kafka 版本 | 2.x 或 3.x 均可（内部使用 kafkajs 客户端） |
| broker 地址 | 示例默认 `127.0.0.1:8092`，可按需修改为 `kafka://broker-host:port` |
| 端口可达 | 客户端需能 TCP 访问 broker 端口 |
| topic `kree4x` | **必须预先创建**（详见下文"topic 要求"） |

**topic 要求**

Kafka 传输默认使用 **broadcast 模式**（`topicMode: 'broadcast'`）：

- 所有节点订阅同一个 topic `kree4x`，每条消息被所有节点接收，非目标节点在上层按 `dstId` 丢弃
- 由于 `allowAutoTopicCreation` 恒为 `false`，**topic 必须在 broker 上预先创建**，否则 attach 会失败

创建命令（以 Kafka 自带工具为例）：

```bash
kafka-topics.sh --bootstrap-server 127.0.0.1:8092 \
  --create --topic kree4x --partitions 1 --replication-factor 1
```

适用场景：需要 1 个 topic 即可，运维简单，生产环境推荐。

**可选：dynamic 模式（topicMode: 'dynamic'）**

- 每个节点订阅 `kree4x-broadcast` 加上自己的私有 topic `kree4x-{nodeId}`
- 消息直达目标节点，避免无效广播，开发测试建议
- 该模式下 `allowAutoTopicCreation` 为 `true`，broker 需允许自动创建 topic（`auto.create.topics.enable=true`）

```javascript
node.attach('kafka://127.0.0.1:8092', { topicMode: 'dynamic' })
```

### 二. 示例代码

在下边的示例中，我们将（请先确保 Kafka broker 已启动且 `kree4x` topic 已创建）：

- nodeA作为Kafka客户端，连接broker，注册calc服务
- nodeB作为Kafka客户端，连接同一broker，注册str服务
- nodeB调用nodeA的calc服务
- nodeA调用nodeB的str服务（双向互调）

```javascript
import Kree4n from '@kree4js/kree4n'
import { KafkaAttachConnectionProvider } from '@kree4js/kafka-attach'

// ── 注册 Kafka 连接提供者（kree4n 默认不包含） ─────────────
const kafkaProvider = new KafkaAttachConnectionProvider()

// ── Node A（Kafka客户端，注册calc服务） ─────────────
const nodeA = Kree4n.create('node-a', 'Kafka RPC server')
nodeA.transport.ports.useConnectionProvider(kafkaProvider)
nodeA.register('calc', {
  add (a, b) { return a + b },
  multiply (a, b) { return a * b }
})
// kafka-attach 是 attach-only，所有节点都以 client 身份连接 broker
nodeA.attach('kafka://127.0.0.1:8092')

// ── Node B（Kafka客户端，注册str服务） ─────────────
const nodeB = Kree4n.create('node-b', 'Kafka RPC client')
nodeB.transport.ports.useConnectionProvider(kafkaProvider)
nodeB.register('str', {
  echo (msg) { return `Echo: ${msg}` },
  greet (name) { return `Hello, ${name}! (via Kafka)` }
})
nodeB.attach('kafka://127.0.0.1:8092')

await nodeA.start()
await nodeB.start()

// 等待 KreeX Grid 通过 Kafka 发现完成（约3秒）
await new Promise(resolve => setTimeout(resolve, 3000))

// node-b 调用 node-a 的 calc 服务
const calc = nodeB.service('calc')
const addResult = await calc.add(10, 20)      // 30
const mulResult = await calc.multiply(6, 7)   // 42

// node-a 调用 node-b 的 str 服务（双向）
const str = nodeA.service('str')
const echoResult = await str.echo('Kafka works!')  // "Echo: Kafka works!"
const greetResult = await str.greet('World')       // "Hello, World! (via Kafka)"
```

## 三、须强调的细节

**KafkaAttachConnectionProvider 需要手动注册**

kree4n 默认注册了 HTTP、TCP、UDP、Socket.IO、HTTP2 等协议，但 Kafka 需要手动引入：

```javascript
import { KafkaAttachConnectionProvider } from '@kree4js/kafka-attach'
node.transport.ports.useConnectionProvider(new KafkaAttachConnectionProvider())
```

**attach-only，没有 listen**

Kafka 没有"服务端监听"的概念。所有节点都是 Kafka 的生产者/消费者（client），通过 `attach` 连接 broker，节点间通过 topic 交换消息。

**broadcast 模式必须预建 topic**

`allowAutoTopicCreation` 恒为 `false`，topic 不存在时 attach 会失败。务必先创建 `kree4x` topic。

**Grid 发现需要时间**

节点启动后，KreeX 的 Grid 机制需要广播并发现对端节点，因此示例在 `start()` 后等待了约 3 秒。如果调用立刻执行，可能因节点尚未互相发现而找不到目标服务。

## 四、涉及到的API:

**Kafka连接**

```typescript
/**
 * Attaches to a remote node via the Kafka protocol.
 *
 * 使用前需在节点上注册 KafkaAttachConnectionProvider：
 * node.transport.ports.useConnectionProvider(new KafkaAttachConnectionProvider())
 *
 * @param {string} url - The URL of the Kafka broker, e.g. "kafka://127.0.0.1:8092".
 * @param {{ topicMode?: 'broadcast'|'dynamic' }} [options] - The topic mode.
 *   'broadcast': 所有节点共享 topic 'kree4x'（默认，topic 需预创建）
 *   'dynamic':   每节点私有 topic 'kree4x-{nodeId}'，允许自动创建
 * @returns {this} The current instance for chaining.
 */
node.attach(url: string, options?: { topicMode?: 'broadcast'|'dynamic' }): this
```

## 五、可运行代码

完整示例代码，参见：[12-kafka-protocol.mjs](../examples/01-basic/12-kafka-protocol.mjs)