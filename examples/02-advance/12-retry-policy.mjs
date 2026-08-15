// internal
import { ExecUtils, PromiseUtils } from '@kree4js/commons-lang'
import Logging from '@kree4js/commons-logging'
import { Retrier } from '@kree4js/commons-retrier'
import { create } from '@kree4js/kree4n'

// module vars
Logging.setLevel('DEBUG')
const logger = Logging.getLogger('retry-policy')

const PORT = 8060

// 服务重试：设置调用重试策略，自动重试，自动Tracing
//
// 拓扑:
//   node-a（不稳定服务） ← node-b（调用方）
//   - node-a注册broken（永远失败）与flaky（前2次失败、第3次成功）两个服务。
//   - node-b未设置重试时：调用直接失败。
//   - node-b设置重试策略后：失败自动重试，直到成功或耗尽次数。
//   - retry(times, interval)：times是总调用次数（不是重试次数）。
//   - 最后一次重试自动开启Tracing，可通过存根lastTracer观察完整调用链路。

/** 构建一个"前2次失败、第3次成功"的不稳定服务存根，可重置计数。 */
function createFlakyService () {
  /** @type {{calls: number, ping: Function, reset: Function}} */
  const stub = {
    calls: 0,
    ping () {
      stub.calls++
      if (stub.calls <= 2) {
        throw new Error('still warming up')
      }
      return 'pong'
    },
    reset () {
      stub.calls = 0
    }
  }
  return stub
}

async function main () {
  // ── node-a：注册不稳定服务 ──
  const flaky = createFlakyService()
  const nodeA = create('node-a', 'Unstable provider')
  nodeA.register('broken', {
    ping () { throw new Error('always broken') }
  })
  nodeA.register('flaky', flaky)
  nodeA.listen(`tcp://127.0.0.1:${PORT}`)
  await nodeA.start()
  logger.info('node-a，已就绪（TCP）')

  // ── node-b：调用方 ──
  const nodeB = create('node-b', 'Retry caller')
  nodeB.attach(`tcp://127.0.0.1:${PORT}`)
  await nodeB.start()
  logger.info('node-b，已就绪（TCP）')

  try {
    // 1. 未设置重试：调用直接失败
    const broken = nodeB.service('broken').timeout(5000)
    try {
      await broken.ping()
      logger.info('[1] 无重试，调用成功（意外）')
    } catch (e) {
      logger.info('[1] 无重试，调用失败')
    }

    // 2. retry(3, 200)：最多3次总调用，间隔200ms
    //    times = 总调用次数（不是重试次数），失败自动重试
    flaky.reset()
    const flakyFixed = nodeB.service('flaky').timeout(5000)
    flakyFixed.retry(3, 200)
    const pongFixed = await flakyFixed.ping()
    logger.info(`[2] retry(3, 200)，${flaky.calls} 次尝试后成功：${pongFixed}`)

    // 3. Retrier实例：指数退避间隔，最多3次
    flaky.reset()
    const flakyBackoff = nodeB.service('flaky').timeout(5000)
    flakyBackoff.retry(Retrier.exponentialBackoff(100).times(3))
    const pongBackoff = await flakyBackoff.ping()
    logger.info(`[3] retry(exponentialBackoff)，${flaky.calls} 次尝试后成功：${pongBackoff}`)

    // 4. 回调形式：链式配置Retrier（固定退避，0抖动）
    flaky.reset()
    const flakyChain = nodeB.service('flaky').timeout(5000)
    flakyChain.retry(r => r.times(3).fixedBackoff(100, 0))
    const pongChain = await flakyChain.ping()
    logger.info(`[4] retry(chain)，${flaky.calls} 次尝试后成功：${pongChain}`)

    // 5. 清除重试：显式retry()，不再自动重试
    const brokenNoRetry = nodeB.service('broken').timeout(5000)
    brokenNoRetry.retry()
    try {
      await brokenNoRetry.ping()
      logger.info('[5] retry() 清除策略，调用成功（意外）')
    } catch (e) {
      logger.info('[5] retry() 清除策略，调用失败：不再自动重试')
    }

    // 6. 最后一次重试自动Tracing
    flaky.reset()
    const flakyTrace = nodeB.service('flaky').timeout(5000)
    flakyTrace.retry(3, 200)
    const pongTrace = await flakyTrace.ping()
    const tracer = flakyTrace.lastTracer
    const timeline = tracer?._timeline
    const actions = timeline == null ? [] : Array.from(timeline, t => t.action)
    logger.info(`[6] retry成功：${pongTrace}；${flaky.calls}次尝试`)
    logger.info(`    最后一次重试自动Tracing：${actions.slice(0, 6).join(' → ')}`)
  } finally {
    await PromiseUtils.delay(100)
    await ExecUtils.quiet(() => nodeB.stop(), logger)
    await ExecUtils.quiet(() => nodeA.stop(), logger)
  }
}

main().catch((err) => logger.error(err))
