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
 * 两个对等节点通过 TCP 互联，各自注册 identifier 服务，互相调用。
 * kreex 没有严格的 client/server 概念 —— 两个节点对称对等，
 * listen/attach 只是连接建立的方向不同，连接后任意一方都可以注册和调用服务。
 */
async function main () {
  // ── Node A：注册 identifier 服务，监听端口 ──────────
  const nodeA = Kree4n.create('node-a')
  nodeA.register('identifier', {
    whoAreYou () {
      return { name: nodeA.name, id: nodeA.id }
    }
  })
  nodeA.listen('tcp://127.0.0.1:8000')

  // ── Node B：注册 identifier 服务，连接 Node A ──────
  const nodeB = Kree4n.create('node-b')
  nodeB.register('identifier', {
    whoAreYou () {
      return { name: nodeB.name, id: nodeB.id }
    }
  })
  nodeB.attach('tcp://127.0.0.1:8000')

  try {
    await nodeA.start()
    logger.info('[node-a] 已启动，监听 tcp://127.0.0.1:8000')
    await nodeB.start()
    logger.info('[node-b] 已启动，已连接到 [node-a]')

    // ── A 调用 B 的 identifier 服务 ──────────────────
    const bIdentifier = nodeA.service('identifier')
    const bInfo = await bIdentifier.whoAreYou()
    logger.info(`[node-a] 调用 [node-b].identifier.whoAreYou() = ${JSON.stringify(bInfo)}`)

    // ── B 调用 A 的 identifier 服务 ──────────────────
    const aIdentifier = nodeB.service('identifier')
    const aInfo = await aIdentifier.whoAreYou()
    logger.info(`[node-b] 调用 [node-a].identifier.whoAreYou() = ${JSON.stringify(aInfo)}`)
  } finally {
    await ExecUtils.quiet(() => nodeB.stop(), logger)
    logger.info(`${nodeB}，已停止`)
    await ExecUtils.quiet(() => nodeA.stop(), logger)
    logger.info(`${nodeA}，已停止`)
  }
}

main().catch((err) => logger.error(err))
