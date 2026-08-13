// internal
import { ExecUtils } from '@kree4js/commons-lang'
import Logging from '@kree4js/commons-logging'
import { create } from '@kree4js/kree4n'

// module vars
Logging.setLevel('DEBUG')
const logger = Logging.getLogger('data-framing')

const PORT = 8071
const PAYLOAD = 'x'.repeat(300 * 1024) // 300KB 大payload

// 数据分帧：
//   - 分帧：DataPack按frameLimit切分为1..N个DataFrame，接收端自动组装还原。
//   - frameLimit是连接（Connection/NetPoint）的能力限制：这条连接最多承载多大的单个数据帧。
//   - 数据经某条连接传送时，即按该连接的frameLimit切分，与"谁发送、谁接收"无关。
//   - 默认帧大小100KB（DataFrameOptions.DefaultFrameSize）。
//   - 通过listen/attach的第二参数 { frameLimit } 声明。

async function run (label, frameLimit) {
  const nodeA = create(`node-a-${label}`)
  nodeA.register('data', {
    fetch () { return PAYLOAD }
  })
  // 该Listen连接声明1024字节的帧能力，响应数据经此连接传送时按此切分
  nodeA.listen(`tcp://127.0.0.1:${PORT}`, frameLimit != null ? { frameLimit } : undefined)

  const nodeB = create(`node-b-${label}`)
  nodeB.attach(`tcp://127.0.0.1:${PORT}`)

  await nodeA.start()
  await nodeB.start()

  // 统计本节点发出的帧数（frame-start事件）
  let frameCount = 0
  nodeA.transport.on('channel-created', (channel) => {
    channel.on('frame-start', () => { frameCount++ })
  })

  const data = nodeB.service('data', { timeout: 10000 })
  const value = await data.fetch()
  logger.info(`${label}: 收到${value.length}字节，发出${frameCount}帧`)

  await ExecUtils.quiet(() => nodeB.stop(), logger)
  logger.info(`${nodeB}，已停止`)
  await ExecUtils.quiet(() => nodeA.stop(), logger)
  logger.info(`${nodeA}，已停止`)
}

async function main () {
  // 1. 默认（100KB/帧）：300KB被分成少量几帧
  await run('默认帧大小(100KB)', undefined)

  // 2. 小帧（1024字节/帧）：帧数显著增多，接收端仍完整还原
  await run('frameLimit=1024', 1024)

  // 3. 中等帧（8KB/帧）
  await run('frameLimit=8192', 8192)
}

main().catch((err) => logger.error(err))
