// 3rd
import { ExecUtils, PromiseUtils } from '@kree4js/commons-lang'
import Logging from '@kree4js/commons-logging'

// internal
import DSC from '@kree4js/dsc'
import Kree4N from '@kree4js/kree4n'

// module vars
Logging.setLevel('DEBUG')
const logger = Logging.getLogger('dsc-distributed-callback')

const PORT = 8098

async function main () {
  // 基于Kree4N节点开启DSC能力
  const nodeA = DSC.enable(Kree4N.create('node-a', '订餐商家（被调方）'))
  const nodeB = DSC.enable(Kree4N.create('node-b', '消费者（发起方）'))

  // 商家开放订餐服务：消费者留下电话(callback)，执行订单后回访
  nodeA.register('restaurant', {
    /**
     * 消费者下单：执行订单（制作、送餐、配送）后，商家回访消费者留下的电话。
     *
     * @param {string} food - 菜品名称。
     * @param {Function} cb - 消费者留下的回访电话：err=回访告知的问题，result=回访内容。
     */
    async order (food, cb) {
      if (food === '地沟油炒饭') {
        // 订单无法执行 → 回调告知失败
        cb(new Error(`本店不供应：${food}`))
        return
      }
      // 执行订单：制作、送餐、配送...（此处简化，直接回访）
      logger.info('[nodeA] 订单已完成（制作、送餐、配送），开始回访电话...')
      try {
        // 回调cb，处理cb结果
        await cb(null, `${food} 已送达，现在是回访电话`) // 执行回访
        logger.info('[nodeA] 回访成功：消费者已接通') // 感知：投递成功
      } catch (err) {
        logger.warn(`[nodeA] 回访失败: ${err.message}`) // 感知：投递失败
      }
    }
  })

  nodeA.listen(`tcp://127.0.0.1:${PORT}`, { frameLimit: 512 })
  nodeB.attach(`tcp://127.0.0.1:${PORT}`, { frameLimit: 512 })

  try {
    await nodeA.start()
    logger.info(`[nodeA] 商家已营业，监听tcp://127.0.0.1:${PORT}`)
    await nodeB.start()

    // 获取服务存根
    const orderService = nodeB.service('restaurant')

    // 消费者下单：回调在nodeB本地执行
    const okCall = PromiseUtils.defer()
    orderService.order('美味的食物', (err, result) => err ? okCall.reject(err) : okCall.resolve(result))
    const okNotice = await okCall.promise
    logger.info(`[nodeB] 接到商家回访（成功）："${okNotice}"`)

    // 点商家没有的菜：订单无法执行
    const failCall = PromiseUtils.defer()
    orderService.order('地沟油炒饭', (err) => err ? failCall.reject(err) : failCall.resolve(err))
    try {
      await failCall.promise
    } catch (err) {
      logger.info(`[nodeB] 接到商家回访（失败）：${err.message}`)
    }
    // 稍微等下，等CB结果回传给商家；否则stop关闭连接，会导致CB结果无法回传
    await PromiseUtils.delay(100)
  } finally {
    await PromiseUtils.delay(100)
    await ExecUtils.quiet(() => nodeB.stop(), logger)
    logger.info(`${nodeB}，已停止`)
    await ExecUtils.quiet(() => nodeA.stop(), logger)
    logger.info(`${nodeA}，已停止`)
  }
}

main().catch((err) => logger.error(err))
