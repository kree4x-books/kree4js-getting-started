// internal
import { ExecUtils } from '@kree4js/commons-lang'
import Logging from '@kree4js/commons-logging'
import { create, Constants, Transports } from '@kree4js/kree4n'

// module vars
Logging.setLevel('DEBUG')
const logger = Logging.getLogger('forward-policy')
const { PDUType } = Constants
const { PduTypeFilterPolicy } = Transports.ForwardPolicies

const PORT_BACKEND = 8062
const PORT_PROXY = 8061

// 帧转发策略：
//   - proxyMode: 开启代理转发模式，节点开始转发非本节点的帧。
//   - forwardAllowAll(): 黑名单模式，默认放行全部帧（proxyMode默认）。
//   - forwardDenyAll(): 白名单模式，默认拒绝全部帧，需allowForwardWhen()放行。
//   - allowForwardWhen(policy): denyAll状态下注册放行规则。
//   - 内置策略：(AllForwardPolicy / PduTypeFilterPolicy /
//     DirectionFilterPolicy / FrameLimitFilterPolicy)

// ── 自定义ForwardPolicy：只放行业务调用帧（ServiceCall/ServiceCallResult）──
class BusinessCallPolicy extends Transports.ForwardPolicy {
  shouldForward (ctx, directData) {
    return directData.pduType === PDUType.ServiceCall ||
      directData.pduType === PDUType.ServiceCallResult
  }
}

async function main () {
  // node-c：服务开放者（后端服务），只允许proxy直连
  const nodeC = create('node-c')
  nodeC.register('greet', {
    hello (name) { return `Hello, ${name}! (from node-c)` },
    ping () { return 'pong' }
  })
  nodeC.listen(`tcp://127.0.0.1:${PORT_BACKEND}`)

  // proxy：转发节点，桥接node-a与node-c
  const proxy = create('proxy', undefined, { transport: { proxyMode: true } })
  proxy.attach(`tcp://127.0.0.1:${PORT_BACKEND}`)
  proxy.listen(`tcp://127.0.0.1:${PORT_PROXY}`)

  // node-a：调用发起者，只能连proxy
  const nodeA = create('node-a')
  nodeA.attach(`tcp://127.0.0.1:${PORT_PROXY}`)

  try {
    await nodeC.start()
    await proxy.start()
    await nodeA.start()

    // 短超时，避免被拦截的调用长时间等待
    const greet = nodeA.service('greet', { timeout: 2000 })

    // 1. proxyMode默认allowAll：转发全部放行
    logger.info('1. proxyMode 默认 allowAll（全部放行）')
    logger.info(`   → ${await greet.hello('World')}`)

    // 2. denyAll + 白名单：只放行Beacon/IHave信号，业务调用帧被拦截
    logger.info('2. forwardDenyAll + PduTypeFilterPolicy 白名单（只放行Beacon/IHave）')
    proxy.transport.forwardDenyAll()
      .allowForwardWhen(new PduTypeFilterPolicy({
        allow: [PDUType.BeaconSignal, PDUType.IHaveSignal]
      }))
    try {
      await greet.hello('blocked')
      logger.info('   → 未被拦截（异常）')
    } catch (err) {
      logger.info('   → hello 被拦截 ✓')
    }

    // 3. forwardAllowAll()恢复：热更新即时生效
    logger.info('3. forwardAllowAll() 恢复（热更新）')
    proxy.transport.forwardAllowAll()
    logger.info(`   → ${await greet.ping()}`)

    // 4. denyAll + 自定义策略：只放行业务调用帧，禁止管理信号穿透
    logger.info('4. forwardDenyAll + 自定义BusinessCallPolicy（只放行业务帧）')
    proxy.transport.forwardDenyAll()
      .allowForwardWhen(new BusinessCallPolicy())
    logger.info(`   → ${await greet.hello('again')}（服务发现已缓存，业务帧放行）`)

    // 5. 恢复默认
    logger.info('5. forwardAllowAll() 恢复默认')
    proxy.transport.forwardAllowAll()
  } finally {
    await ExecUtils.quiet(() => nodeA.stop(), logger)
    logger.info(`${nodeA}，已停止`)
    await ExecUtils.quiet(() => proxy.stop(), logger)
    logger.info(`${proxy}，已停止`)
    await ExecUtils.quiet(() => nodeC.stop(), logger)
    logger.info(`${nodeC}，已停止`)
  }
}

main().catch((err) => logger.error(err))
