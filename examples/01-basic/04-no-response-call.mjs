// internal
import { ExecUtils, PromiseUtils } from '@kree4js/commons-lang'
import Logging from '@kree4js/commons-logging'
import Kree4n from '@kree4js/kree4n'

// vars
Logging.setLevel('DEBUG')
const logger = Logging.getLogger('no-response-call')

/**
 * 演示无返回服务调用：方法名以'_'开头，调用即发，不等待调用结果。
 *
 * 演示内容：
 * - 无返回调用：caller调用 calc._hello('World')，callee执行 hello()，但不会回发调用结果
 * - 普通调用：calc.hello('World') 作为对照，会等待并获取调用结果
 */
async function main () {
  // ── callee：监听端口，注册服务 ───────────────
  const callee = Kree4n.create('node-a')
  callee.listen('tcp://127.0.0.1:8104') // Listen TCP

  // caller：Attach到callee端口
  const caller = Kree4n.create('node-b')
  caller.attach('tcp://127.0.0.1:8104') // Attach TCP

  try {
    await callee.start()
    logger.info('[node-a] 已启动，监听tcp://127.0.0.1:8104')

    await caller.start()
    logger.info('[node-b] 已启动，已连接到 [node-a]')

    // 注册"日志收集"服务：hello() 有返回值，log() 无返回值
    const collector = {
      hello (name) {
        logger.info(`[node-a] collector.hello('${name}') 被调用`)
        return `Hello, ${name}!`
      },
      log (message) {
        logger.info(`[node-a] collector.log('${message}') 被调用`)
      }
    }
    callee.register('collector', collector)
    logger.info('[node-a] 已注册服务: collector')

    const collectorStub = caller.service('collector')

    // ── 1. 普通调用：等待调用结果 ────────────────
    const helloResult = await collectorStub.hello('Kree4JS')
    logger.info(`[node-b] 普通调用 collector.hello('Kree4JS') 返回: ${helloResult}`)

    // ── 2. 无返回调用：方法名以'_'开头，不等待调用结果 ──────
    await collectorStub._log('这是一条发后即忘的日志')
    logger.info('[node-b] 无返回调用 collector._log(...) 已完成（无需等待结果）')
  } finally {
    // 停止前留出在途帧的送达窗口
    await PromiseUtils.delay(100)
    // 依次停止，ExecUtils.quiet吞掉单个stop异常，避免一个失败阻塞另一个退出
    await ExecUtils.quiet(() => callee.stop(), logger)
    logger.info(`${callee}，已停止`)
    await ExecUtils.quiet(() => caller.stop(), logger)
    logger.info(`${caller}，已停止`)
  }
}

main().catch((err) => logger.error(err))
