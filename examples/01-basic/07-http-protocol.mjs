// internal
import { ExecUtils } from '@kree4js/commons-lang'
import Logging from '@kree4js/commons-logging'
import Kree4n from '@kree4js/kree4n'

// vars
Logging.setLevel('DEBUG')
const logger = Logging.getLogger('http-protocol')

/**
 * HTTP协议连接示例：两个NodeJS节点通过HTTP协议互联，进行双向RPC调用。
 *
 * - nodeA（http-listen）：创建HTTP服务器，监听端口，注册calc服务
 * - nodeB（http-attach）：以HTTP客户端身份连接到nodeA，注册str服务
 *
 * 调用流程：
 *   node-b调用node-a的calc服务
 *   node-a调用node-b的str服务（双向互调）
 */
async function main () {
  // ── Node A（HTTP服务器，注册calc服务） ─────────────
  const nodeA = Kree4n.create('node-a', 'HTTP RPC server')
  nodeA.register('calc', {
    add (a, b) { return a + b },
    multiply (a, b) { return a * b }
  })
  nodeA.listen('http://127.0.0.1:8040')

  // ── Node B（HTTP客户端，注册str服务） ─────────────
  const nodeB = Kree4n.create('node-b', 'HTTP RPC client')
  nodeB.register('str', {
    echo (msg) { return `Echo: ${msg}` },
    greet (name) { return `Hello, ${name}! (via HTTP)` }
  })
  nodeB.attach('http://127.0.0.1:8040')

  try {
    await nodeA.start()
    logger.info('[nodeA] HTTP listening on http://127.0.0.1:8040')

    await nodeB.start()
    logger.info('[nodeB] HTTP connected to nodeA')

    // node-b调用node-a的calc服务
    const calc = nodeB.service('calc')
    const addResult = await calc.add(10, 20)
    const mulResult = await calc.multiply(6, 7)
    logger.info(`[nodeB] node-a.calc.add(10, 20) = ${addResult}`)
    logger.info(`[nodeB] node-a.calc.multiply(6, 7) = ${mulResult}`)

    // node-a调用node-b的str服务（双向）
    const str = nodeA.service('str')
    const echoResult = await str.echo('HTTP works!')
    const greetResult = await str.greet('World')
    logger.info(`[nodeA] node-b.str.echo('HTTP works!') = ${echoResult}`)
    logger.info(`[nodeA] node-b.str.greet('World') = ${greetResult}`)
  } finally {
    await ExecUtils.quiet(() => nodeB.stop(), logger)
    logger.info(`${nodeB}，已停止`)
    await ExecUtils.quiet(() => nodeA.stop(), logger)
    logger.info(`${nodeA}，已停止`)
  }
}

main().catch((err) => logger.error(err))
