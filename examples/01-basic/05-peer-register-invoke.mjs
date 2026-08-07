// internal
import { ExecUtils } from '@kree4js/commons-lang'
import Logging from '@kree4js/commons-logging'
import Kree4n from '@kree4js/kree4n'

// vars
Logging.setLevel('DEBUG')
const logger = Logging.getLogger('peer-register-invoke')

/**
 * 对等节点 RPC 通信（Peer-to-Peer）。
 *
 * 两个对等节点通过 TCP 互联，node-a 暴露计算服务，node-b 连过去调用。
 * kreex 没有严格的 client/server 概念 —— 两个节点对称对等，
 * listen/attach 只是连接建立的方向不同，连接后任意一方都可以注册和调用服务。
 * service() 返回的 CallerServiceCluster 已被代理包装（Delegate），
 * 可以直接调用业务方法名，无需 invoke()。
 */
async function main () {
  // ── Node A：监听端口，注册服务 ───────────────────
  const nodeA = Kree4n.create('node-a')
  nodeA.register('math', {
    add (a, b) {
      return a + b
    },
    multiply (a, b) {
      return a * b
    }
  })
  nodeA.listen('tcp://127.0.0.1:8000') // Listen TCP

  // ── Node B：连接 Node A，调用其服务 ──────────────
  const nodeB = Kree4n.create('node-b')
  nodeB.attach('tcp://127.0.0.1:8000') // Attach TCP

  try {
    await nodeA.start()
    await nodeB.start()
    logger.info('[node-a] 已启动，监听 tcp://127.0.0.1:8000')
    logger.info('[node-b] 已启动，已连接到 [node-a]')

    // 直接调用业务方法，如同本地对象
    const math = nodeB.service('math')
    const addResult = await math.add(10, 20)
    logger.info(`[node-b] 调用 [node-a].math.add(10, 20) = ${addResult}`)

    const multiplyResult = await math.multiply(6, 7)
    logger.info(`[node-b] 调用 [node-a].math.multiply(6, 7) = ${multiplyResult}`)

    // ── 对等特性：Node A 也可以调用 Node B 的服务 ─────
    nodeB.register('echo', {
      ping () {
        return 'pong from node-B'
      }
    })

    const echo = nodeA.service('echo')
    const pingResult = await echo.ping()
    logger.info(`[node-a] 调用 [node-b].echo.ping() = ${pingResult}`)
  } finally {
    // 依次停止，ExecUtils.quiet 吞掉单个 stop 异常，避免一个失败阻塞另一个退出
    await ExecUtils.quiet(() => nodeB.stop(), logger)
    await ExecUtils.quiet(() => nodeA.stop(), logger)
    logger.info('[node-a, node-b] 两个节点已停止')
  }
}

main().catch((err) => logger.error(err))
