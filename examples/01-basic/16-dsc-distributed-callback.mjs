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
     * 双向返回值：
     * - 本方法 `return` 的结果，是RPC调用本身的返回值，由消费者（caller）收到
     * - `await cb()` 直接返回消费者callback函数的返回值（callee可感知并使用）；
     *   Callback抛错时则抛出该异常
     *
     * @param {string} food - 菜品名称。
     * @param {Function} cb - 消费者留下的回访电话：err=回访告知的问题，result=回访内容。
     * @returns {Promise<Object>} RPC调用自身的返回值：订单与回访评价。
     */
    async order (food, cb) {
      if (food === '地沟油炒饭') {
        // 订单无法执行 → 回调告知失败；await cb()会抛出caller侧cb的异常，此处吞掉
        await cb(new Error(`本店不供应：${food}`)).catch(() => {})
        return
      }
      // 执行订单：制作、送餐、配送...（此处简化，直接回访）
      logger.info('[nodeA] 订单已完成（制作、送餐、配送），开始回访电话...')
      try {
        // 回调cb，处理cb结果：await cb()直接返回消费者callback的返回值（无需解包）
        const ack = await cb(null, `${food} 已送达，现在是回访电话`) // 执行回访
        logger.info(`[nodeA] 回访成功：消费者已接通，回访评价=${ack}`) // 感知：投递成功，并使用cb返回值
        // RPC调用本身有返回值：消费者的下单调用将收到此结果
        return { order: food, ack }
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

    // 消费者下单：回调函数体在nodeB本地执行，其return值是回访评价（回传商家）；
    // RPC调用本身（order()的return）返回订单与评价，由这里await到
    const rpcResult = await orderService.order('美味的食物', (err, result) => {
      if (err) {
        logger.warn(`[nodeB] 回访接通异常：${err.message}`)
        return
      }
      logger.info(`[nodeB] 接到商家回访："${result}"`)
      return '满意，五星好评' // 此返回值经临时服务RPC回传，商家（callee）可感知
    })
    logger.info(`[nodeB] 订单完成：${JSON.stringify(rpcResult)}（RPC调用自身的返回值）`)

    // 点商家没有的菜：订单无法执行
    const failCall = PromiseUtils.defer()
    orderService.order('地沟油炒饭', (err) => {
      if (err) {
        failCall.reject(err)
      } else {
        failCall.resolve(err)
      }
    })
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
