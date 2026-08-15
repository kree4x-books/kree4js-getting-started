// internal
import { ExecUtils, PromiseUtils } from '@kree4js/commons-lang'
import Logging from '@kree4js/commons-logging'
import { create } from '@kree4js/kree4n'

// module vars
Logging.setLevel('DEBUG')
const logger = Logging.getLogger('frame-forwarding')

const PORT_TCP = 8081
const PORT_UDP = 8082

// 帧中继：开启节点数据转发，支持异构间接通信
//
// 拓扑:
//   node-a (TCP) ←→ proxy (帧中继) ←→ node-c (UDP)
//   - node-a 与 node-c 无共同通信协议，无法直连。
//   - proxy 开启 proxyMode，同时桥接 TCP 与 UDP，自动转发两者的帧。
//   - 任意一侧的调用，经 proxy 帧中继到达对侧，实现异构间接通信。

async function main () {
  // node-c：仅支持UDP的服务开放者，注册greet服务
  const nodeC = create('node-c')
  nodeC.register('greet', {
    hello (name) { return `Hello, ${name}! (from node-c via UDP)` }
  })
  nodeC.listen(`udp://127.0.0.1:${PORT_UDP}`, { frameLimit: 1152, ack: true })

  // proxy：帧中继节点，桥接TCP与UDP
  const proxy = create('proxy', undefined, { transport: { proxyMode: true } })
  proxy.attach(`udp://127.0.0.1:${PORT_UDP}`, { frameLimit: 1152, ack: true })
  proxy.listen(`tcp://127.0.0.1:${PORT_TCP}`, { frameLimit: 1152 })

  // node-a：仅支持TCP的调用发起者，注册hello服务
  const nodeA = create('node-a')
  nodeA.register('hello', {
    hi (name) { return `Hi, ${name}! (from node-a via TCP)` }
  })
  nodeA.attach(`tcp://127.0.0.1:${PORT_TCP}`, { frameLimit: 1152 })

  try {
    await nodeC.start()
    logger.info('node-c，已就绪（UDP）')
    await proxy.start()
    logger.info('proxy，已就绪（TCP↔UDP帧中继）')
    await nodeA.start()
    logger.info('node-a，已就绪（TCP）')

    // 1. TCP侧 → UDP侧：node-a调用node-c的greet服务，经proxy帧中继
    logger.info('=== node-a(TCP) → node-c(UDP) ===')
    const greet = nodeA.service('greet', { timeout: 8000 })
    logger.info(`   → ${await greet.hello('World')}`)

    // 2. UDP侧 → TCP侧：node-c调用node-a的hello服务，同样经proxy帧中继
    logger.info('=== node-c(UDP) → node-a(TCP) ===')
    const hello = nodeC.service('hello', { timeout: 8000 })
    logger.info(`   → ${await hello.hi('World')}`)
  } finally {
    await PromiseUtils.delay(100)
    await ExecUtils.quiet(() => nodeA.stop(), logger)
    logger.info(`${nodeA}，已停止`)
    await ExecUtils.quiet(() => proxy.stop(), logger)
    logger.info(`${proxy}，已停止`)
    await ExecUtils.quiet(() => nodeC.stop(), logger)
    logger.info(`${nodeC}，已停止`)
  }
}

main().catch((err) => logger.error(err))
