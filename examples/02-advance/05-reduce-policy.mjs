// internal
import { ExecUtils } from '@kree4js/commons-lang'
import Logging from '@kree4js/commons-logging'
import { create, SelectPolicy, ReducePolicy, Transports } from '@kree4js/kree4n'

// module vars
Logging.setLevel('DEBUG')
const logger = Logging.getLogger('reduce-policy')
const { WhoHasWaitPolicy } = Transports

const PORT_A = 8051
const PORT_B = 8052
const PORT_C = 8053

// 结果归约策略：
//   - 选中多个目标节点后，框架对每个节点发起调用，得到 N 个 ServiceCallResult。
//   - 调用者只需一个结果，因此用 ReducePolicy 把 N 个结果归约为 1 个。
//   - 内置策略：ReduceFirst / ReduceFirstSuccess / ReduceFirstFailure /
//     ReduceMinNumber / ReduceMaxNumber / ReduceSumNumber / ReduceAvgNumber /
//     ReduceBest / ReduceWorst。
//   - 通过 sensor.reduce(policy) 设定当前存根的归约策略。

// ── 自定义 ReducePolicy：取结果序列的中位数 ──
class ReduceMedianNumber extends ReducePolicy.ReducePolicy {
  reduce (results) {
    if (results.length === 0) return undefined
    // 过滤出成功的数值结果，排序后取中位数
    const values = results
      .filter(r => r.ok && typeof r.value === 'number')
      .map(r => r.value)
      .sort((a, b) => a - b)
    if (values.length === 0) return results[0]
    const mid = Math.floor(values.length / 2)
    return values.length % 2 === 0
      ? { ok: true, value: (values[mid - 1] + values[mid]) / 2 }
      : { ok: true, value: values[mid] }
  }
}

async function main () {
  // 3 个服务节点，返回可区分的数值：node-a≈10, node-b≈20, node-c≈30
  const nodeA = create('node-a', 'Service node a')
  nodeA.register('sensor', { read () { return 10 + Math.random() * 5 } })
  nodeA.listen(`tcp://127.0.0.1:${PORT_A}`)
  await nodeA.start()

  const nodeB = create('node-b', 'Service node b')
  nodeB.register('sensor', { read () { return 20 + Math.random() * 5 } })
  nodeB.listen(`tcp://127.0.0.1:${PORT_B}`)
  await nodeB.start()

  const nodeC = create('node-c', 'Service node c')
  nodeC.register('sensor', { read () { return 30 + Math.random() * 5 } })
  nodeC.listen(`tcp://127.0.0.1:${PORT_C}`)
  await nodeC.start()

  // 调用方：attach 到 3 个服务节点
  const caller = create('caller', 'Reduce caller')
  caller.attach(`tcp://127.0.0.1:${PORT_A}`)
  caller.attach(`tcp://127.0.0.1:${PORT_B}`)
  caller.attach(`tcp://127.0.0.1:${PORT_C}`)
  await caller.start()
  await caller.whenReady(nodeA.id)
  await caller.whenReady(nodeB.id)
  await caller.whenReady(nodeC.id)

  // 归约需要多个目标，先全选再归约
  const sensor = caller.service('sensor')
  // 等待收集到 3 个提供者，保证 SelectAll 能选到全部节点
  sensor.waitWhoHas(WhoHasWaitPolicy.three(5000))
  sensor.select(new SelectPolicy.SelectAll())

  try {
    // 1. ReduceFirst：取第一个结果
    logger.info('=== ReduceFirst（取第一个）===')
    sensor.reduce(new ReducePolicy.ReduceFirst())
    logger.info(`read: ${await sensor.read()}`)

    // 2. ReduceFirstSuccess：取第一个成功结果
    logger.info('=== ReduceFirstSuccess（取第一个成功）===')
    sensor.reduce(new ReducePolicy.ReduceFirstSuccess())
    logger.info(`read: ${await sensor.read()}`)

    // 3. ReduceMinNumber：取最小值
    logger.info('=== ReduceMinNumber（取最小值）===')
    sensor.reduce(new ReducePolicy.ReduceMinNumber())
    logger.info(`read: ${await sensor.read()}`)

    // 4. ReduceMaxNumber：取最大值
    logger.info('=== ReduceMaxNumber（取最大值）===')
    sensor.reduce(new ReducePolicy.ReduceMaxNumber())
    logger.info(`read: ${await sensor.read()}`)

    // 5. ReduceSumNumber：求和
    logger.info('=== ReduceSumNumber（求和）===')
    sensor.reduce(new ReducePolicy.ReduceSumNumber())
    logger.info(`read: ${await sensor.read()}`)

    // 6. ReduceAvgNumber：求平均
    logger.info('=== ReduceAvgNumber（求平均）===')
    sensor.reduce(new ReducePolicy.ReduceAvgNumber())
    logger.info(`read: ${await sensor.read()}`)

    // 7. ReduceBest：用 comparer 选最优（数值最大）
    logger.info('=== ReduceBest（comparer 选数值最大）===')
    sensor.reduce(new ReducePolicy.ReduceBest((a, b) => b - a))
    logger.info(`read: ${await sensor.read()}`)

    // 8. ReduceWorst：用 comparer 选最差（数值最小）
    logger.info('=== ReduceWorst（comparer 选数值最小）===')
    sensor.reduce(new ReducePolicy.ReduceWorst((a, b) => b - a))
    logger.info(`read: ${await sensor.read()}`)

    // 9. 自定义 ReduceMedianNumber：中位数
    logger.info('=== 自定义 ReduceMedianNumber（中位数）===')
    sensor.reduce(new ReduceMedianNumber())
    logger.info(`read: ${await sensor.read()}`)
  } finally {
    await ExecUtils.quiet(() => caller.stop(), logger)
    logger.info(`${caller}，已停止`)
    await ExecUtils.quiet(() => nodeC.stop(), logger)
    logger.info(`${nodeC}，已停止`)
    await ExecUtils.quiet(() => nodeB.stop(), logger)
    logger.info(`${nodeB}，已停止`)
    await ExecUtils.quiet(() => nodeA.stop(), logger)
    logger.info(`${nodeA}，已停止`)
  }
}

main().catch((err) => logger.error(err))
