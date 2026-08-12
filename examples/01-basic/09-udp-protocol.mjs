// internal
import { ExecUtils } from '@kree4js/commons-lang'
import Logging from '@kree4js/commons-logging'
import Kree4n from '@kree4js/kree4n'

// vars
Logging.setLevel('DEBUG')
const logger = Logging.getLogger('udp-protocol')

/**
 * UDP协议连接示例：两个NodeJS节点通过UDP协议互联，进行双向RPC调用。
 *
 * - nodeA（udp-listen）：监听UDP端口，注册calc服务
 * - nodeB（udp-attach）：以UDP客户端身份连接nodeA，注册str服务
 *
 * 关键点：
 * - UDP是数据报协议，单帧大小受限，必须分帧（frameLimit）
 * - frameLimit: 1152暂存框架限制，避免IP分片
 * - ack: true启用帧级ACK，保证UDP消息可靠到达
 *
 * 调用流程：
 *   node-b调用node-a的calc服务
 *   node-a调用node-b的str服务（双向互调）
 */
async function main () {
  // ── Node A（UDP服务器，注册calc服务） ─────────────
  const nodeA = Kree4n.create('node-a', 'UDP RPC server')
  nodeA.register('calc', {
    add (a, b) { return a + b },
    multiply (a, b) { return a * b }
  })
  nodeA.listen('udp://127.0.0.1:8060', { frameLimit: 1152, ack: true })

  // ── Node B（UDP客户端，注册str服务） ─────────────
  const nodeB = Kree4n.create('node-b', 'UDP RPC client')
  nodeB.register('str', {
    echo (msg) { return `Echo: ${msg}` },
    greet (name) { return `Hello, ${name}! (via UDP)` }
  })
  nodeB.attach('udp://127.0.0.1:8060', { frameLimit: 1152, ack: true })

  try {
    await nodeA.start()
    logger.info('[nodeA] UDP listening on udp://127.0.0.1:8060 (ack=true)')

    await nodeB.start()
    logger.info('[nodeB] UDP connected to nodeA')

    // node-b调用node-a的calc服务
    const calc = nodeB.service('calc')
    const addResult = await calc.add(10, 20)
    const mulResult = await calc.multiply(6, 7)
    logger.info(`[nodeB] node-a.calc.add(10, 20) = ${addResult}`)
    logger.info(`[nodeB] node-a.calc.multiply(6, 7) = ${mulResult}`)

    // node-a调用node-b的str服务（双向）
    const str = nodeA.service('str')
    const echoResult = await str.echo('UDP works!')
    const greetResult = await str.greet('World')
    logger.info(`[nodeA] node-b.str.echo('UDP works!') = ${echoResult}`)
    logger.info(`[nodeA] node-b.str.greet('World') = ${greetResult}`)
  } finally {
    await ExecUtils.quiet(() => nodeB.stop(), logger)
    logger.info(`${nodeB}，已停止`)
    await ExecUtils.quiet(() => nodeA.stop(), logger)
    logger.info(`${nodeA}，已停止`)
  }
}

main().catch((err) => logger.error(err))