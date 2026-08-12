// internal
import { ExecUtils } from '@kree4js/commons-lang'
import Logging from '@kree4js/commons-logging'
import { create, Transports } from '@kree4js/kree4n'

// module vars
Logging.setLevel('DEBUG')
const logger = Logging.getLogger('wait-policy')
const { WhoHasWaitPolicy } = Transports

const PORT_A = 8030
const PORT_B = 8031

// 服务发现等待策略：
//   - waitWhoHas(policy): 存根级等待——首次调用时等WhoHas收集到足够的IHave
//     WhoHasWaitPolicy.one(n) 等1个提供者 / two(n) 等2个 / three(n) 等3个
//   注意：等待只在"本次调用"的收集窗口内有效，等不到足够提供者会直接抛错。

async function main () {
  // node-a：注册sensor
  const nodeA = create('node-a')
  nodeA.register('sensor', {
    read () {
      return 'read-from-node-a'
    }
  })
  nodeA.listen(`tcp://127.0.0.1:${PORT_A}`)

  // node-b：同样注册sensor
  const nodeB = create('node-b')
  nodeB.register('sensor', {
    read () {
      return 'read-from-node-b'
    }
  })
  nodeB.listen(`tcp://127.0.0.1:${PORT_B}`)

  // 调用发起者：等1个提供者
  const callerOne = create('caller-one', '等1个提供者')
  callerOne.attach(`tcp://127.0.0.1:${PORT_A}`)
  callerOne.attach(`tcp://127.0.0.1:${PORT_B}`)

  try {
    await nodeA.start()
    await nodeB.start()
    await callerOne.start()

    // 获取服务存根
    const sensorOne = callerOne.service('sensor')
    // waitWhoHas(one)：至少1个，等待3s超时
    sensorOne.waitWhoHas(WhoHasWaitPolicy.one(3000))
    const value = await sensorOne.read()
    logger.info(`读到: ${value}`) // 被调用的是A或者B，都有可能
  } finally {
    await ExecUtils.quiet(() => callerOne.stop(), logger)
    logger.info(`${callerOne}，已停止`)
    await ExecUtils.quiet(() => nodeB.stop(), logger)
    logger.info(`${nodeB}，已停止`)
    await ExecUtils.quiet(() => nodeA.stop(), logger)
    logger.info(`${nodeA}，已停止`)
  }
}

main().catch((err) => logger.error(err))
