// internal
import { ExecUtils, PromiseUtils } from '@kree4js/commons-lang'
import Logging from '@kree4js/commons-logging'
import Kree4n from '@kree4js/kree4n'

// vars
Logging.setLevel('DEBUG')
const logger = Logging.getLogger('websocket-protocol')

/**
 * WebSocket协议连接示例：两个NodeJS节点通过WebSocket协议互联，进行双向RPC调用。
 *
 * - nodeA（http-listen）：创建HTTP服务器，内置WebSocket升级端点（/kreex/ws），注册calc服务
 * - nodeB（websocket-attach）：以WebSocket客户端身份连接nodeA，注册str服务
 *
 * 关键点：
 * - WebSocketAttachConnectionProvider由kree4n默认注册，无需手动引入
 * - WebSocket服务端由http-listen内部提供，nodeA仍用http:// 监听
 * - nodeB使用ws:// 协议与普通HTTP客户端区分
 *
 * 调用流程：
 *   node-b调用node-a的calc服务
 *   node-a调用node-b的str服务（双向互调）
 */
async function main () {
  // ── Node A（HTTP + WebSocket服务器，注册calc服务） ─────────────
  const nodeA = Kree4n.create('node-a', 'WebSocket RPC server')
  nodeA.register('calc', {
    add (a, b) { return a + b },
    multiply (a, b) { return a * b }
  })
  nodeA.listen('http://127.0.0.1:8070')

  // ── Node B（WebSocket客户端，注册str服务） ─────────────
  const nodeB = Kree4n.create('node-b', 'WebSocket RPC client')
  nodeB.register('str', {
    echo (msg) { return `Echo: ${msg}` },
    greet (name) { return `Hello, ${name}! (via WebSocket)` }
  })
  nodeB.attach('ws://127.0.0.1:8070')

  try {
    await nodeA.start()
    logger.info('[nodeA] HTTP listening on http://127.0.0.1:8070 (WebSocket endpoint at /kreex/ws)')

    await nodeB.start()
    logger.info('[nodeB] WebSocket connected to nodeA')

    // node-b调用node-a的calc服务
    const calc = nodeB.service('calc')
    const addResult = await calc.add(10, 20)
    const mulResult = await calc.multiply(6, 7)
    logger.info(`[nodeB] node-a.calc.add(10, 20) = ${addResult}`)
    logger.info(`[nodeB] node-a.calc.multiply(6, 7) = ${mulResult}`)

    // node-a调用node-b的str服务（双向）
    const str = nodeA.service('str')
    const echoResult = await str.echo('WebSocket works!')
    const greetResult = await str.greet('World')
    logger.info(`[nodeA] node-b.str.echo('WebSocket works!') = ${echoResult}`)
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
