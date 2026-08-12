// internal
import { ExecUtils } from '@kree4js/commons-lang'
import Logging from '@kree4js/commons-logging'
import Kree4n from '@kree4js/kree4n'

// vars
Logging.setLevel('DEBUG')
const logger = Logging.getLogger('indirect-call')

/**
 * 间接服务调用：通过Hub节点转发RPC请求。
 *
 * 星型拓扑（Hub-Leaf）：
 * - Hub（中心节点）：hub，负责转发所有消息
 * - Leaf（外围节点）：leafNode1、leafNode2，只能与Hub直连
 *
 * 拓扑结构：
 *   leafNode1 → hub ← leafNode2
 *
 * 服务注册：
 *   leafNode1注册greet服务
 *
 * 连接关系：
 *   leafNode1连接到hub
 *   leafNode2连接到hub
 *
 * 调用流程：
 *   leafNode2调用greet服务，经hub转发到leafNode1
 */
async function main () {
  // ── Hub Node（中心转发节点） ──────────────────────
  const hub = Kree4n.create('hub')
  hub.listen('tcp://127.0.0.1:8010')

  // ── Leaf Node 1（后端服务，连接Hub） ──────────────
  const leafNode1 = Kree4n.create('leaf-1')
  leafNode1.register('greet', {
    hello (name) { return `Hello, ${name}! (from leaf-1)` }
  })
  leafNode1.attach('tcp://127.0.0.1:8010')

  // ── Leaf Node 2（调用方，连接Hub） ────────────────
  const leafNode2 = Kree4n.create('leaf-2')
  leafNode2.attach('tcp://127.0.0.1:8010')

  try {
    await hub.start()
    logger.info('[hub] 已启动，监听tcp://127.0.0.1:8010')

    await leafNode1.start()
    logger.info('[leafNode1] 已启动，已连接到hub')

    await leafNode2.start()
    logger.info('[leafNode2] 已启动，已连接到hub')

    // leafNode2调用leafNode1的greet服务，经hub转发
    const greet = leafNode2.service('greet')
    const result = await greet.hello('World')
    logger.info(`[leafNode2] 调用 [leafNode1].greet.hello('World') = ${result}`)
  } finally {
    await ExecUtils.quiet(() => leafNode2.stop(), logger)
    logger.info(`${leafNode2}，已停止`)
    await ExecUtils.quiet(() => leafNode1.stop(), logger)
    logger.info(`${leafNode1}，已停止`)
    await ExecUtils.quiet(() => hub.stop(), logger)
    logger.info(`${hub}，已停止`)
  }
}

main().catch((err) => logger.error(err))
