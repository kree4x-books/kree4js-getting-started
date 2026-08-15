// internal
import { ExecUtils, PromiseUtils } from '@kree4js/commons-lang'
import Logging from '@kree4js/commons-logging'
import { create } from '@kree4js/kree4n'

// module vars
Logging.setLevel('DEBUG')
const logger = Logging.getLogger('heterogeneous-grid')

const PORT_TCP = 8091
const PORT_UDP = 8092

// 异构组网：多通信协议融合，组建通信网格
//
// 拓扑:
//   node-a (TCP) ←→ node-b (UDP+TCP桥接) ←→ node-c (UDP)
//   - node-a 只支持TCP，node-c 只支持UDP，两者无共同协议。
//   - node-b 同时连接TCP与UDP，并开启proxyMode，成为两个异构网络的桥接节点。
//   - 网格中任意节点，均可跨协议发现并调用其他节点的服务。

async function main () {
  // node-a：TCP网络节点，注册calc服务
  const nodeA = create('node-a', 'TCP service node')
  nodeA.register('calc', {
    add (a, b) { return a + b },
    multiply (a, b) { return a * b }
  })
  nodeA.listen(`tcp://127.0.0.1:${PORT_TCP}`, { frameLimit: 1152 })

  // node-b：桥接节点，同时连接TCP与UDP，开启proxyMode跨网络转发
  const nodeB = create('node-b', 'UDP bridge node', { transport: { proxyMode: true } })
  nodeB.register('str', {
    echo (msg) { return `Echo: ${msg}` },
    greet (name) { return `Hello, ${name}! (from node-b)` }
  })
  nodeB.attach(`tcp://127.0.0.1:${PORT_TCP}`, { frameLimit: 1152 })
  nodeB.listen(`udp://127.0.0.1:${PORT_UDP}`, { frameLimit: 1152, ack: true })

  // node-c：UDP网络节点，注册greet服务
  const nodeC = create('node-c', 'UDP caller node')
  nodeC.register('greet', {
    hello (name) { return `Hello, ${name}! (from node-c)` }
  })
  nodeC.attach(`udp://127.0.0.1:${PORT_UDP}`, { frameLimit: 1152, ack: true })

  try {
    await nodeA.start()
    logger.info('node-a，已就绪（TCP）')
    await nodeB.start()
    logger.info('node-b，已就绪（TCP↔UDP桥接）')
    await nodeC.start()
    logger.info('node-c，已就绪（UDP）')

    // 等待网格发现：跨协议节点经桥接节点互相可见
    await nodeC.whenReady(nodeB.id)
    await nodeA.whenReady(nodeB.id)
    await nodeA.whenReady(nodeC.id)

    // 1. node-c(UDP)调用node-a(TCP)的calc：跨协议，经node-b转发
    logger.info('=== node-c(UDP) → node-a(TCP)：跨协议调用 ===')
    const calc = nodeC.service('calc', { timeout: 8000 })
    logger.info(`   calc.add(10, 20) = ${await calc.add(10, 20)}`)
    logger.info(`   calc.multiply(6, 7) = ${await calc.multiply(6, 7)}`)

    // 2. node-c(UDP)调用node-b(UDP)的str：同协议直连
    logger.info('=== node-c(UDP) → node-b(UDP)：同协议调用 ===')
    const str = nodeC.service('str', { timeout: 8000 })
    logger.info(`   str.greet('World') = ${await str.greet('World')}`)

    // 3. node-a(TCP)调用node-c(UDP)的greet：跨协议，经node-b转发
    logger.info('=== node-a(TCP) → node-c(UDP)：跨协议调用 ===')
    const greet = nodeA.service('greet', { timeout: 8000 })
    logger.info(`   greet.hello('World') = ${await greet.hello('World')}`)
  } finally {
    // UDP是fire-and-forget数据报：给最后一批在途帧留出送达窗口再停止
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
