// Diagnostic: run 11-transport-policy logic then dump what keeps the process alive.
import { ExecUtils, PromiseUtils } from '@kree4js/commons-lang'
import Logging from '@kree4js/commons-logging'
import { create, Transports } from '@kree4js/kree4n'
import whyIsNodeRunning from '/Users/rodney/kree4x/Kree4JS/node_modules/why-is-node-running/index.js'

Logging.setLevel('INFO')
const { TransportPolicy } = Transports
const { AllPolicy, PreferredProtocolPolicy } = Transports.TransportPolicies

const PORT_TCP = 8075
const PORT_UDP = 8076

class PassThroughPolicy extends TransportPolicy {
  selectConnection (connections) {
    return connections
  }

  selectChannel (channels) {
    return channels
  }
}

async function main () {
  const greeting = { hello (n) { return 'Hello ' + n } }
  const nodeA = create('node-a', 'TCP+UDP provider')
  for (const name of ['greet', 'greet-all', 'greet-tcp', 'greet-udp', 'greet-nx', 'greet-custom']) {
    nodeA.register(name, greeting)
  }
  nodeA.listen(`tcp://127.0.0.1:${PORT_TCP}`, { frameLimit: 1152 })
  nodeA.listen(`udp://127.0.0.1:${PORT_UDP}`, { frameLimit: 1152, ack: true })
  await nodeA.start()

  const nodeB = create('node-b', 'Policy caller')
  nodeB.attach(`tcp://127.0.0.1:${PORT_TCP}`, { frameLimit: 1152 })
  nodeB.attach(`udp://127.0.0.1:${PORT_UDP}`, { frameLimit: 1152, ack: true })
  await nodeB.start()

  await PromiseUtils.delay(100)

  const resultDefault = await nodeB.service('greet').hello('default')
  console.log(`[1] 默认，调用成功：${resultDefault}`)

  const greetAll = nodeB.service('greet-all')
  greetAll.transportPolicy(new AllPolicy())
  const resultAll = await greetAll.hello('all')
  console.log(`[2] AllPolicy，调用成功：${resultAll}`)

  const greetTcp = nodeB.service('greet-tcp')
  greetTcp.transportPolicy(new PreferredProtocolPolicy('tcp'))
  const resultTcp = await greetTcp.hello('tcp')
  console.log(`[3] PreferredProtocolPolicy('tcp')，调用成功：${resultTcp}`)

  const greetUdp = nodeB.service('greet-udp')
  greetUdp.transportPolicy(new PreferredProtocolPolicy('udp'))
  const resultUdp = await greetUdp.hello('udp')
  console.log(`[4] PreferredProtocolPolicy('udp')，调用成功：${resultUdp}`)

  const greetNx = nodeB.service('greet-nx')
  greetNx.transportPolicy(new PreferredProtocolPolicy('nonexistent'))
  try {
    await greetNx.hello('nonexistent')
    console.log('[5] nonexistent，调用成功（意外）')
  } catch (e) {
    console.log(`[5] nonexistent，调用失败（预期）：${e?.cause?.message ?? e.message}`)
  }

  const greetCustom = nodeB.service('greet-custom')
  greetCustom.transportPolicy(new PassThroughPolicy())
  const resultCustom = await greetCustom.hello('custom')
  console.log(`[6] PassThroughPolicy（自定义），调用成功：${resultCustom}`)

  await PromiseUtils.delay(100)
  await ExecUtils.quiet(() => nodeB.stop(), console)
  await ExecUtils.quiet(() => nodeA.stop(), console)
  console.log('=== stopped, now dumping handles ===')
  await whyIsNodeRunning()
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
