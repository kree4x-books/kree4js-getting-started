// internal
import { ExecUtils, PromiseUtils } from '@kree4js/commons-lang'
import Logging from '@kree4js/commons-logging'
import Kree4n from '@kree4js/kree4n'

// vars
Logging.setLevel('DEBUG')
const logger = Logging.getLogger('connect-two-nodes')

/**
 * 两个对等节点的连接建立（仅验证连通性）。
 *
 * node-a监听TCP端口，node-b主动attach连入；
 * 框架提供了语法糖whenReady()，用于等待并检查两节点之间是否建立数据连接。
 * 退出时无论连接是否成功，都需在finally中顺序停止两个节点，
 * 且单个节点stop失败不应阻塞另一个节点退出。
 */
async function main () {
  // ── Node A：监听端口 ─────────────────────────────
  const nodeA = Kree4n.create('node-a')
  nodeA.listen('tcp://127.0.0.1:8080') // Listen TCP

  // ── Node B：连接Node A ─────────────────────────
  const nodeB = Kree4n.create('node-b')
  nodeB.attach('tcp://127.0.0.1:8080') // Attach TCP

  try {
    // 优先启动Listen，可以避免Attach重试耗时
    await nodeA.start()
    logger.info(`${nodeA}，已启动`)
    await nodeB.start()
    logger.info(`${nodeB}，已启动`)

    // 语法糖：等待并检查两个节点间是否有已发现彼此，超时5000ms
    const found = await nodeA.whenReady(nodeB, 5000)
    logger.info(`[node-a/node-b] 节点间动态发现：${found ? '成功' : '失败'}`)
  } finally {
    // 停止前留出在途帧的送达窗口
    await PromiseUtils.delay(100)
    // 依次停止，ExecUtils.quiet吞掉单个stop异常，避免一个失败阻塞另一个退出
    await ExecUtils.quiet(() => nodeB.stop(), logger)
    logger.info(`${nodeA}，已停止`)
    await ExecUtils.quiet(() => nodeA.stop(), logger)
    logger.info(`${nodeB}，已停止`)
  }
}

main().catch((err) => logger.error(err))
