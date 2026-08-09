// internal
import { ExecUtils } from '@kree4js/commons-lang'
import Logging from '@kree4js/commons-logging'
import { SocketioListenConnectionProvider } from '@kree4js/socketio-listen'
import { SocketioAttachConnectionProvider } from '@kree4js/socketio-attach'
import Kree4n from '@kree4js/kree4n'

// vars
Logging.setLevel('DEBUG')
const logger = Logging.getLogger('socketio-protocol')

/**
 * Socket.IO协议连接示例：两个NodeJS节点通过Socket.IO协议互联，进行双向RPC调用。
 *
 * - nodeA（socketio-listen）：监听Socket.IO端口，注册calc服务
 * - nodeB（socketio-attach）：以Socket.IO客户端身份连接nodeA，注册str服务
 *
 * 关键点：
 * - Socket.IO 提供多传输回退（WebSocket → HTTP 长轮询）和房间/事件模型
 * - Socket.IO 是第三方库，kree4n 不内置，需独立安装并手动注册 Provider：
 *   npm install @kree4js/socketio-listen @kree4js/socketio-attach
 * - listen/attach 两侧都要注册对应的 Connection Provider，否则 io:// 无法识别
 * - Socket.IO URL 使用 io:// 协议
 *
 * 调用流程：
 *   node-b 调用 node-a 的 calc 服务
 *   node-a 调用 node-b 的 str 服务（双向互调）
 */
async function main () {
  // ── Node A（Socket.IO服务器，注册calc服务） ─────────────
  const nodeA = Kree4n.create('node-a', 'Socket.IO RPC server')
  // SocketioListenConnectionProvider 需手动注册后才能识别 io:// 协议
  nodeA.useConnectionProvider(new SocketioListenConnectionProvider())
  nodeA.register('calc', {
    add (a, b) { return a + b },
    multiply (a, b) { return a * b }
  })
  nodeA.listen('io://127.0.0.1:8030')

  // ── Node B（Socket.IO客户端，注册str服务） ─────────────
  const nodeB = Kree4n.create('node-b', 'Socket.IO RPC client')
  // SocketioAttachConnectionProvider 需手动注册后才能识别 io:// 协议
  nodeB.useConnectionProvider(new SocketioAttachConnectionProvider())
  nodeB.register('str', {
    echo (msg) { return `Echo: ${msg}` },
    greet (name) { return `Hello, ${name}! (via Socket.IO)` }
  })
  nodeB.attach('io://127.0.0.1:8030')

  try {
    await nodeA.start()
    logger.info('[nodeA] Socket.IO listening on io://127.0.0.1:8030')

    await nodeB.start()
    logger.info('[nodeB] Socket.IO connected to nodeA')

    // node-b 调用 node-a 的 calc 服务
    const calc = nodeB.service('calc')
    const addResult = await calc.add(10, 20)
    const mulResult = await calc.multiply(6, 7)
    logger.info(`[nodeB] node-a.calc.add(10, 20) = ${addResult}`)
    logger.info(`[nodeB] node-a.calc.multiply(6, 7) = ${mulResult}`)

    // node-a 调用 node-b 的 str 服务（双向）
    const str = nodeA.service('str')
    const echoResult = await str.echo('Socket.IO works!')
    const greetResult = await str.greet('World')
    logger.info(`[nodeA] node-b.str.echo('Socket.IO works!') = ${echoResult}`)
    logger.info(`[nodeA] node-b.str.greet('World') = ${greetResult}`)
  } finally {
    await ExecUtils.quiet(() => nodeB.stop(), logger)
    logger.info(`${nodeB}，已停止`)
    await ExecUtils.quiet(() => nodeA.stop(), logger)
    logger.info(`${nodeA}，已停止`)
  }
}

main().catch((err) => logger.error(err))
