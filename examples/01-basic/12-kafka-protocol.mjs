// internal
import { ExecUtils, PromiseUtils } from '@kree4js/commons-lang'
import Logging from '@kree4js/commons-logging'
import Kree4n from '@kree4js/kree4n'
import { KafkaAttachConnectionProvider } from '@kree4js/kafka-attach'

// vars
Logging.setLevel('DEBUG')
const logger = Logging.getLogger('kafka-protocol')

/**
 * Kafka协议连接示例：两个NodeJS节点通过Kafka broker中转，进行双向RPC调用。
 *
 * - 前提：需要已启动的Kafka broker（本书示例默认kafka://127.0.0.1:8092）
 * - kafka-attach是attach-only，所有节点都作为client连接到broker
 * - KafkaAttachConnectionProvider需要手动注册，kree4n默认不提供
 *
 * 调用流程：
 *   node-b调用node-a的calc服务
 *   node-a调用node-b的str服务（双向互调）
 */
async function main () {
  // Kafka代理需手动注册
  const kafkaProvider = new KafkaAttachConnectionProvider()

  // ── Node A（Kafka client，注册calc服务） ─────────────
  const nodeA = Kree4n.create('node-a', 'Kafka RPC server')
  nodeA.useConnectionProvider(kafkaProvider)
  nodeA.register('calc', {
    add (a, b) { return a + b },
    multiply (a, b) { return a * b }
  })
  // 连接到Kafka broker，topicMode默认 'broadcast'（单topic kree4x）
  nodeA.attach('kafka://127.0.0.1:8092')

  // ── Node B（Kafka client，注册str服务） ─────────────
  const nodeB = Kree4n.create('node-b', 'Kafka RPC client')
  nodeB.useConnectionProvider(kafkaProvider)
  nodeB.register('str', {
    echo (msg) { return `Echo: ${msg}` },
    greet (name) { return `Hello, ${name}! (via Kafka)` }
  })
  nodeB.attach('kafka://127.0.0.1:8092')

  try {
    await nodeA.start()
    logger.info('[nodeA] attached to Kafka (broadcast mode, topic kree4x)')

    await nodeB.start()
    logger.info('[nodeB] attached to Kafka (broadcast mode, topic kree4x)')

    // 等待KreeX Grid通过Kafka发现对方节点就绪
    await nodeA.whenReady(nodeB, 5000)
    await nodeB.whenReady(nodeA, 5000)

    // node-b调用node-a的calc服务
    const calc = nodeB.service('calc')
    const addResult = await calc.add(10, 20)
    const mulResult = await calc.multiply(6, 7)
    logger.info(`[nodeB] node-a.calc.add(10, 20) = ${addResult}`)
    logger.info(`[nodeB] node-a.calc.multiply(6, 7) = ${mulResult}`)

    // node-a调用node-b的str服务（双向）
    const str = nodeA.service('str')
    const echoResult = await str.echo('Kafka works!')
    const greetResult = await str.greet('World')
    logger.info(`[nodeA] node-b.str.echo('Kafka works!') = ${echoResult}`)
    logger.info(`[nodeA] node-b.str.greet('World') = ${greetResult}`)
  } finally {
    await PromiseUtils.delay(100)
    await ExecUtils.quiet(() => nodeB.stop(), logger)
    logger.info(`${nodeB}，已停止`)
    await ExecUtils.quiet(() => nodeA.stop(), logger)
    logger.info(`${nodeA}，已停止`)
  }
}

main().catch((err) => logger.error(err))
