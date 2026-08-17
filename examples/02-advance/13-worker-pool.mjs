// internal
import { ExecUtils, PromiseUtils } from '@kree4js/commons-lang'
import Logging from '@kree4js/commons-logging'
import Kree4n from '@kree4js/kree4n'

// vars
Logging.setLevel('DEBUG')
const logger = Logging.getLogger('worker-pool')

/**
 * 演示Worker池：大载荷的编解码卸载到Worker进程，主进程不被阻塞。
 *
 * 演示内容：
 * - create()时通过options.worker开启Worker模式（workerCount、threshold）
 * - Worker入口脚本由kree4n自动注入，无需配置
 * - callee允许Worker模式，caller不开启，两相对照
 * - 调用含大载荷的服务方法，验证调用正常完成
 */
async function main () {
  // ── callee：开启Worker模式（2个worker，阈值64KB） ──
  const callee = Kree4n.create('node-a', '', {
    worker: {
      workerCount: 2,
      threshold: 64 * 1024
    }
  })
  callee.listen('tcp://127.0.0.1:8130') // Listen TCP

  // caller：不使用Worker模式
  const caller = Kree4n.create('node-b')
  caller.attach('tcp://127.0.0.1:8130') // Attach TCP

  try {
    await callee.start()
    logger.info('[node-a] 已启动（Worker模式：2个worker，阈值64KB），监听tcp://127.0.0.1:8130')

    await caller.start()
    logger.info('[node-b] 已启动（未开启Worker模式），已连接到 [node-a]')

    // 注册"数据暂存"服务：echo() 原样返回收到的载荷
    const store = {
      echo (data) {
        if (typeof data === 'string') {
          return data
        }
        return { received: data.length }
      }
    }
    callee.register('store', store)
    logger.info('[node-a] 已注册服务: store')

    const storeStub = caller.service('store')

    // ── 1. 小载荷调用（低于阈值，主进程直接处理） ──────
    const small = await storeStub.echo('hello')
    logger.info(`[node-b] store.echo('hello') = ${small}`)

    // ── 2. 大载荷调用（超过阈值，编解码卸载到Worker进程） ──
    const payload = 'x'.repeat(128 * 1024) // 128KB，超过64KB阈值
    const result = await storeStub.echo(payload)
    logger.info(`[node-b] store.echo(128KB载荷) 完成，返回长度 = ${result.length}`)
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
