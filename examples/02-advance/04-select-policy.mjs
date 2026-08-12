// internal
import { ExecUtils } from '@kree4js/commons-lang'
import Logging from '@kree4js/commons-logging'
import { create, SelectPolicy, Transports } from '@kree4js/kree4n'

// module vars
Logging.setLevel('DEBUG')
const logger = Logging.getLogger('select-policy')
const { WhoHasWaitPolicy } = Transports

const PORT_A = 8041
const PORT_B = 8042
const PORT_C = 8043

// 服务选择策略：
//   - 服务发现完成后，从候选服务节点群中挑选1..N个节点用于本次调用。
//   - 内置策略：SelectFirst（首节点）/ SelectLoop（轮询）/ SelectRandom（随机）
//     / SelectSticky（粘性）/ SelectTop（前N个）/ SelectAll（全选）。
//   - 通过sensor.select(policy) 设定存根的选择策略。
//
// 演示方式：每个存根都waitWhoHas(three) 等满3个提供者，
//   select只是从这3个候选节点里挑选，各策略差异一目了然。

// ── 自定义SelectPolicy：按最近响应时间选最快节点 ──
class FastestResponsePolicy extends SelectPolicy.SelectPolicy {
  constructor (howMany = 1) {
    super(howMany)
    this._responseTimes = new Map() // nodeId → lastResponseTime
  }

  // 记录响应时间，通常由拦截器在afterCall中调用
  recordResponseTime (nodeId, time) {
    this._responseTimes.set(nodeId, time)
  }

  select (candidates, ctx, methodName, params, options) {
    if (candidates.length === 0) return undefined
    // 按上次响应时间排序（快者优先），无记录的排最后
    const scored = candidates
      .map(c => ({ candidate: c, time: this._responseTimes.get(c) ?? Infinity }))
      .sort((a, b) => a.time - b.time)
    return scored.slice(0, this.howMany).map(s => s.candidate)
  }
}

async function main () {
  // 3个服务节点，注册同名sensor服务；返回可区分的数值：node-a≈10, node-b≈20, node-c≈30
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

  logger.info(`node-a on tcp://127.0.0.1:${PORT_A}  (read ≈ 10)`)
  logger.info(`node-b on tcp://127.0.0.1:${PORT_B}  (read ≈ 20)`)
  logger.info(`node-c on tcp://127.0.0.1:${PORT_C}  (read ≈ 30)`)

  // 调用方：attach到3个服务节点
  const caller = create('caller', 'Select caller')
  caller.attach(`tcp://127.0.0.1:${PORT_A}`)
  caller.attach(`tcp://127.0.0.1:${PORT_B}`)
  caller.attach(`tcp://127.0.0.1:${PORT_C}`)
  await caller.start()
  await caller.whenReady(nodeA.id)
  await caller.whenReady(nodeB.id)
  await caller.whenReady(nodeC.id)

  try {
    // 每个策略演示前，都重新获取sensor服务存根（类型都是服务存根，只是设定的选择策略不同）
    let sensor

    // 1. SelectFirst：始终选第一个节点（等满3个，始终命中node-a ≈ 10）
    logger.info('=== SelectFirst（选第一个节点）===')
    sensor = caller.service('sensor')
    sensor.waitWhoHas(WhoHasWaitPolicy.three(5000))
    sensor.select(new SelectPolicy.SelectFirst())
    for (let i = 0; i < 3; i++) {
      logger.info(`read: ${Math.round(await sensor.read())}`)
    }

    // 2. SelectLoop：轮询选择，从3个候选里依次挑选（≈ 10, 20, 30）
    logger.info('=== SelectLoop（轮询选择）===')
    sensor = caller.service('sensor')
    sensor.waitWhoHas(WhoHasWaitPolicy.three(5000))
    sensor.select(new SelectPolicy.SelectLoop())
    for (let i = 0; i < 3; i++) {
      logger.info(`read: ${Math.round(await sensor.read())}`)
    }

    // 3. SelectRandom：随机选择，从3个候选里随机挑一个
    logger.info('=== SelectRandom（随机选择）===')
    sensor = caller.service('sensor')
    sensor.waitWhoHas(WhoHasWaitPolicy.three(5000))
    sensor.select(new SelectPolicy.SelectRandom())
    for (let i = 0; i < 3; i++) {
      logger.info(`read: ${Math.round(await sensor.read())}`)
    }

    // 4. SelectSticky：首次选定后，后续尽量复用同一节点
    logger.info('=== SelectSticky(1)（粘性选择）===')
    sensor = caller.service('sensor')
    sensor.waitWhoHas(WhoHasWaitPolicy.three(5000))
    sensor.select(new SelectPolicy.SelectSticky(1))
    for (let i = 0; i < 3; i++) {
      logger.info(`read: ${Math.round(await sensor.read())}`)
    }

    // 5. SelectTop(2)：取前2个（多目标，需配合ReducePolicy归约）
    logger.info('=== SelectTop(2)（选前2个）===')
    sensor = caller.service('sensor')
    sensor.waitWhoHas(WhoHasWaitPolicy.three(5000))
    sensor.select(new SelectPolicy.SelectTop(2))
    logger.info(`read: ${Math.round(await sensor.read())}`)

    // 6. SelectAll：全选（多目标，配合ReducePolicy聚合）
    logger.info('=== SelectAll（全选）===')
    sensor = caller.service('sensor')
    sensor.waitWhoHas(WhoHasWaitPolicy.three(5000))
    sensor.select(new SelectPolicy.SelectAll())
    logger.info(`read: ${Math.round(await sensor.read())}`)

    // 7. 自定义FastestResponsePolicy
    logger.info('=== 自定义FastestResponsePolicy（选最快）===')
    const fastestPolicy = new FastestResponsePolicy(1)
    fastestPolicy.recordResponseTime('node-a', 50)
    fastestPolicy.recordResponseTime('node-b', 30) // 最快
    fastestPolicy.recordResponseTime('node-c', 100)
    sensor = caller.service('sensor')
    sensor.waitWhoHas(WhoHasWaitPolicy.three(5000))
    sensor.select(fastestPolicy)
    logger.info(`read: ${Math.round(await sensor.read())}`)
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
