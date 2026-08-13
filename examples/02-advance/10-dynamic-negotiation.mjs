// internal
import { ExecUtils } from '@kree4js/commons-lang'
import Logging from '@kree4js/commons-logging'
import { create } from '@kree4js/kree4n'
import { Transports } from '@kree4js/kree4js'

// module vars
Logging.setLevel('DEBUG')
const logger = Logging.getLogger('dynamic-negotiation')

const { ProtocolMatchAdvicePolicy } = Transports.DynamicConnectionAdvicePolicies
const PORT_CENTER = 8040

// 只协商 tcp 协议的自定义协商策略：
// 默认策略会把双方共同支持的所有协议（http/https/tcp/tls/...）都列为协商候选，
// 其中 https/tls 需要证书，无证书环境下会先失败并产生超时噪音。
// 在纯 TCP 场景，自定义策略只保留 tcp，协商更干净、更快。
class TcpOnlyAdvicePolicy extends ProtocolMatchAdvicePolicy {
  advise (ctx, targetNodeId, currentAdvices = []) {
    const advices = super.advise(ctx, targetNodeId, currentAdvices)
    if (advices == null) return undefined
    return advices.filter(advice => {
      if (advice.needsNegotiation) {
        return advice.protocol === 'tcp'
      }
      return advice.url != null && advice.url.startsWith('tcp://')
    })
  }
}

// 动态链路：开启通信协商，支持动态链路直连与断线重连
//
// 拓扑:
//   Node-Center（中继） ← node-a（服务提供者） / node-b（服务调用者）
//   - node-a、node-b 均开启动态协商（enableDynamicConnection），并 attach 到 center。
//   - 首次调用经 center 转发；协商成功后，后续调用走 node-a ↔ node-b 直连。
//   - node-b 停止后重启，会再次经 center 转发调用，并重新协商建立直连（断线重连）。

/** 轮询等待动态直连建立（协商为异步多轮握手，需要时间）。 */
async function waitDirect (node, targetId, timeoutMs = 8000, expectDirect = true) {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    if (node.transport.grid.hasDirectChannel(targetId) === expectDirect) return true
    await new Promise(resolve => setTimeout(resolve, 100))
  }
  return false
}

async function main () {
  /** @type {ReturnType<typeof create>|undefined} */
  let nodeB2

  // ── Node-Center：网格中心（proxyMode 开启帧中继） ──
  const center = create('center', 'Grid center', { transport: { proxyMode: true } })
  center.listen(`tcp://127.0.0.1:${PORT_CENTER}`)
  await center.start()
  logger.info('center，已就绪（TCP）')

  // ── Node-A：服务提供者，开启动态协商 ──
  const nodeA = create('node-a', 'Service provider')
  nodeA.register('greet', {
    hello (name) { return `Hello, ${name}! (from node-a)` }
  })
  // 动态协商直连时由一方动态开启监听；默认绑定0.0.0.0（所有网卡），此处限定只绑本机回环
  nodeA.transport.enableDynamicConnection(new TcpOnlyAdvicePolicy())
  nodeA.transport.limitDynamicListenAddress('127.0.0.1')
  nodeA.attach(`tcp://127.0.0.1:${PORT_CENTER}`)
  await nodeA.start()
  logger.info('node-a，已就绪（TCP，动态协商已开启）')

  // ── Node-B：服务调用者，开启动态协商 ──
  const nodeB = create('node-b', 'Service caller')
  nodeB.transport.enableDynamicConnection(new TcpOnlyAdvicePolicy())
  nodeB.transport.limitDynamicListenAddress('127.0.0.1')
  nodeB.attach(`tcp://127.0.0.1:${PORT_CENTER}`)
  await nodeB.start()
  logger.info('node-b，已就绪（TCP，动态协商已开启）')

  // 首次调用会触发 WhoHas 查询完成网格发现，同时触发直连协商
  const greet = nodeB.service('greet', { timeout: 8000 })

  try {
    // 1. 首次调用：经 center 转发，同时触发直连协商
    logger.info(`[1] node-b → node-a.greet.hello('World') = ${await greet.hello('World')}`)
    logger.info(`    node-b 与 node-a 直连：${nodeB.transport.grid.hasDirectChannel(nodeA.id)}`)

    // 2. 等待协商完成：动态直连建立（异步多轮握手，轮询等待）
    const direct = await waitDirect(nodeB, nodeA.id)
    logger.info(`[2] 协商完成，node-b 与 node-a 直连：${direct}`)

    // 3. 再次调用：直连通信，不再经 center 转发
    logger.info(`[3] node-b → node-a.greet.hello('Again') = ${await greet.hello('Again')}`)

    // 4. 断线重连：node-b 停止，直连断开（等待清理完成）
    await new Promise(resolve => setTimeout(resolve, 100))
    await nodeB.stop()
    const broken = await waitDirect(nodeA, nodeB.id, 8000, false)
    logger.info(`[4] node-b 已停止，直连断开：${broken}`)

    // 5. 重启 node-b：重新 attach 到 center，再次调用触发重新协商
    nodeB2 = create('node-b', 'Service caller (reconnected)')
    nodeB2.transport.enableDynamicConnection(new TcpOnlyAdvicePolicy())
    nodeB2.transport.limitDynamicListenAddress('127.0.0.1')
    nodeB2.attach(`tcp://127.0.0.1:${PORT_CENTER}`)
    await nodeB2.start()

    const greet2 = nodeB2.service('greet', { timeout: 8000 })
    logger.info(`[5] node-b 重启，重新协商直连：${await greet2.hello('Again')}`)
    const direct2 = await waitDirect(nodeB2, nodeA.id)
    logger.info(`    重新协商完成，node-b 与 node-a 直连：${direct2}`)
  } finally {
    await ExecUtils.quiet(() => nodeB2?.stop(), logger)
    await ExecUtils.quiet(() => nodeB.stop(), logger)
    await ExecUtils.quiet(() => nodeA.stop(), logger)
    await ExecUtils.quiet(() => center.stop(), logger)
  }
}

main().catch((err) => logger.error(err))