// internal
import { ExecUtils, PromiseUtils } from '@kree4js/commons-lang'
import Logging from '@kree4js/commons-logging'
import { create } from '@kree4js/kree4n'

// module vars
Logging.setLevel('DEBUG')
const logger = Logging.getLogger('service-interceptor-aop')

const PORT = 8020

// 服务拦截器做"服务认证 + 结果脱敏"：
//   - 调用发起者：出站拦截器自动注入Token，业务代码零感知
//   - 被调用者：入站拦截器校验Token，非法直接短路拒绝
//   - 被调用者：入站afterCall统一脱敏，在结果回传调用者前改写value
// options会随服务调用跨网传送，入站拦截器与服务方法ctx都能取到。

// ── 出站拦截器（挂在调用发起者）：自动注入Token ────────
class TokenInjectInterceptor {
  beforeCall (ctx, cluster, method, params, options) {
    // options随调用序列化跨网传送，在这里"搭车"注入Token
    options.token = TOKEN
    logger.info(`[${cluster.name}] 注入Token: ${TOKEN}`)
  }
}

// ── 入站拦截器（挂在被调用者）：校验Token ────────────
const TOKEN = 'secret-token'

class TokenCheckInterceptor {
  beforeCall (ctx, cluster, method, params, options) {
    const token = options?.token
    if (!this.isValidToken(token)) {
      logger.warn(`[nodeA] 拒绝非法调用: ${cluster.name}.${method}, token=${token}`)
      // 非空IntercepResult短路：服务方法不会执行，直接回送失败
      return { ok: false, error: new Error('Invalid token: Unauthorized') }
    }
    logger.info(`[nodeA] Token校验通过: ${cluster.name}.${method}`)
  }

  // 校验Token
  isValidToken (token) {
    return token === TOKEN
  }
}

// ── 入站拦截器（挂在被调用者）：afterCall统一脱敏 ──────
class DataMaskInterceptor {
  afterCall (ctx, result, cluster, method, params, options) {
    // result是ServiceCallResult：{ ok, value, error }
    // 返回undefined保留原结果；返回非空IntercepResult覆盖结果
    if (result?.ok && result.value != null) {
      logger.info(`[nodeA] afterCall脱敏: ${cluster.name}.${method}`)
      return { ok: true, value: this.mask(result.value) }
    }
    // 失败结果原样保留，不做处理
  }

  // 把对象中的手机号、身份证号打码
  mask (data) {
    const masked = { ...data }
    if (masked.phone != null) {
      masked.phone = masked.phone.replace(/^(\d{3})\d{4}(\d{4})$/, '$1****$2')
    }
    if (masked.idCard != null) {
      masked.idCard = masked.idCard.replace(/^(\d{6})\d+(\w{2})$/, '$1********$2')
    }
    return masked
  }
}

async function main () {
  // nodeA：数据中心，开放data服务，入站校验Token + 统一脱敏
  const nodeA = create('node-a', '数据中心')
  nodeA.useInInterceptor(new TokenCheckInterceptor())
  nodeA.useInInterceptor(new DataMaskInterceptor())
  nodeA.register('data', {
    getUser (id, ctx) {
      // 服务方法的最后一个参数是ServiceCallContext，
      // ctx.serviceCall.options.token可取得调用发起者注入的Token
      logger.info(`[nodeA] getUser() 执行，收到Token: ${ctx.serviceCall.options.token}`)
      // 业务代码只关心返回原始数据，脱敏交给afterCall拦截器统一处理
      return { id, name: '张三', phone: '13812345678', idCard: '110101199001011234' }
    }
  })
  nodeA.listen(`tcp://127.0.0.1:${PORT}`)

  // nodeB：合法应用，出站自动注入Token
  const nodeB = create('node-b', '合法应用')
  nodeB.useOutInterceptor(new TokenInjectInterceptor())
  nodeB.attach(`tcp://127.0.0.1:${PORT}`)

  // nodeC：未授权方，不注入Token
  const nodeC = create('node-c', '未授权方')
  nodeC.attach(`tcp://127.0.0.1:${PORT}`)

  try {
    await nodeA.start()
    await nodeB.start()
    await nodeC.start()
    await nodeB.whenReady(nodeA, 5000)
    await nodeC.whenReady(nodeA, 5000)

    // nodeB：业务代码直接调用，无感知Token（拦截器自动注入）
    const dataB = nodeB.service('data')

    // nodeC：同样调用，未注入Token，被入站拦截器拒绝
    const dataC = nodeC.service('data')

    logger.info('--- nodeB：合法调用，结果被afterCall统一脱敏 ---')
    const user = await dataB.getUser('u-1')
    logger.info(`nodeB拿到脱敏后的数据: ${JSON.stringify(user)}`)

    logger.info('--- nodeC：未授权调用 ---')
    // 方法调用形式：失败时直接抛出异常
    try {
      await dataC.getUser('u-1')
    } catch (err) {
      logger.info('nodeC调用被拒绝: ok=false')
    }
  } finally {
    await PromiseUtils.delay(100)
    await ExecUtils.quiet(() => nodeC.stop(), logger)
    logger.info(`${nodeC}，已停止`)
    await ExecUtils.quiet(() => nodeB.stop(), logger)
    logger.info(`${nodeB}，已停止`)
    await ExecUtils.quiet(() => nodeA.stop(), logger)
    logger.info(`${nodeA}，已停止`)
  }
}

main().catch((err) => logger.error(err))
