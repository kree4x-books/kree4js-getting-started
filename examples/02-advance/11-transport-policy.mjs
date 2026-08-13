// internal
import { ExecUtils, PromiseUtils } from '@kree4js/commons-lang'
import Logging from '@kree4js/commons-logging'
import { create, Transports } from '@kree4js/kree4n'

// module vars
Logging.setLevel('DEBUG')
const logger = Logging.getLogger('transport-policy')

const PORT_TCP = 8065
const PORT_UDP = 8066

const { TransportPolicy } = Transports
const { AllPolicy, PreferredProtocolPolicy } = Transports.TransportPolicies

// 传输策略：设置TransportPolicy，为服务调用适配通信协议与信道
//
// 拓扑:
//   node-a（服务提供方，TCP+UDP） ← node-b（调用方，TCP+UDP双挂接）
//   - 服务注册在node-a，node-b与node-a之间同时存在TCP、UDP两条直连信道。
//   - 默认（不设置policy）：自动选择可用信道，调用成功。
//   - AllPolicy()：显式"全部信道都可用"，等价于默认行为。
//   - PreferredProtocolPolicy('tcp')：从TCP+UDP信道中只走TCP信道。
//   - PreferredProtocolPolicy('udp')：只走UDP信道。
//   - PreferredProtocolPolicy('nonexistent')：无匹配信道，调用失败，
//     错误信息包含策略名与目标节点，用于排查。
//   - 自定义策略：继承TransportPolicy，覆写selectChannel()/selectConnection()，
//     按协议（或其他维度）过滤信道。
//   - 注意1：同一服务名对应一个缓存的服务集群（cluster），策略在首次调用时
//     随服务代理（ProxyService）创建而被固化；之后修改不生效。
//     因此不同策略场景必须使用不同服务名，各自独立一个集群。
//   - 注意2：UDP数据报不可靠，UDP监听与挂接必须开启ack应答与帧大小限制；
//     TCP无此要求。

// 自定义策略：退化策略示例——所有信道原样放行（等价于AllPolicy）
class PassThroughPolicy extends TransportPolicy {
  selectConnection (connections) {
    return connections
  }

  selectChannel (channels) {
    return channels
  }
}

async function main () {
  // ── node-a：注册服务，TCP+UDP监听 ──
  const greeting = { hello (n) { return 'Hello ' + n } }
  const nodeA = create('node-a', 'TCP+UDP provider')
  for (const name of ['greet', 'greet-all', 'greet-tcp', 'greet-udp', 'greet-nx', 'greet-custom']) {
    nodeA.register(name, greeting)
  }
  nodeA.listen(`tcp://127.0.0.1:${PORT_TCP}`, { frameLimit: 1152 })
  nodeA.listen(`udp://127.0.0.1:${PORT_UDP}`, { frameLimit: 1152, ack: true })
  await nodeA.start()
  logger.info('node-a，已就绪（TCP+UDP）')

  // ── node-b：调用方，TCP+UDP双挂接 ──
  const nodeB = create('node-b', 'Policy caller')
  nodeB.attach(`tcp://127.0.0.1:${PORT_TCP}`, { frameLimit: 1152 })
  nodeB.attach(`udp://127.0.0.1:${PORT_UDP}`, { frameLimit: 1152, ack: true })
  await nodeB.start()
  logger.info('node-b，已就绪（TCP+UDP）')

  // TCP挂接需要negotiate握手，UDP即时连通；等片刻让两条信道都建立
  await PromiseUtils.delay(100)

  try {
    // 1. 默认（不设置policy）：自动选信道，调用成功
    const resultDefault = await nodeB.service('greet').hello('default')
    logger.info(`[1] 默认，调用成功：${resultDefault}`)

    // 2. AllPolicy：显式"全部信道都可用"，与默认行为一致
    const greetAll = nodeB.service('greet-all')
    greetAll.transportPolicy(new AllPolicy())
    const resultAll = await greetAll.hello('all')
    logger.info(`[2] AllPolicy，调用成功：${resultAll}`)

    // 3. PreferredProtocolPolicy('tcp')：只走TCP信道
    const greetTcp = nodeB.service('greet-tcp')
    greetTcp.transportPolicy(new PreferredProtocolPolicy('tcp'))
    const resultTcp = await greetTcp.hello('tcp')
    logger.info(`[3] PreferredProtocolPolicy('tcp')，调用成功：${resultTcp}`)

    // 4. PreferredProtocolPolicy('udp')：只走UDP信道
    const greetUdp = nodeB.service('greet-udp')
    greetUdp.transportPolicy(new PreferredProtocolPolicy('udp'))
    const resultUdp = await greetUdp.hello('udp')
    logger.info(`[4] PreferredProtocolPolicy('udp')，调用成功：${resultUdp}`)

    // 5. PreferredProtocolPolicy('nonexistent')：无匹配信道，调用失败
    const greetNx = nodeB.service('greet-nx')
    greetNx.transportPolicy(new PreferredProtocolPolicy('nonexistent'))
    try {
      await greetNx.hello('nonexistent')
      logger.info('[5] nonexistent，调用成功（意外）')
    } catch (e) {
      const reason = e?.cause?.message ?? e.message
      logger.info(`[5] nonexistent，调用失败：${reason}`)
    }

    // 6. 自定义策略：全量放行，调用成功
    const greetCustom = nodeB.service('greet-custom')
    greetCustom.transportPolicy(new PassThroughPolicy())
    const resultCustom = await greetCustom.hello('custom')
    logger.info(`[6] PassThroughPolicy（自定义），调用成功：${resultCustom}`)
  } finally {
    // UDP是fire-and-forget数据报：给最后一批在途帧留出送达窗口再停止
    await PromiseUtils.delay(200)
    await ExecUtils.quiet(() => nodeB.stop(), logger)
    await ExecUtils.quiet(() => nodeA.stop(), logger)
  }
}

main().catch((err) => logger.error(err))