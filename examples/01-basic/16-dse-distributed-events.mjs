// internal
import { EventEmitter } from '@kree4js/commons-events'
import { ExecUtils, PromiseUtils } from '@kree4js/commons-lang'
import Logging from '@kree4js/commons-logging'
import DSE from '@kree4js/dse'
import Kree4n from '@kree4js/kree4n'

// module vars
Logging.setLevel('DEBUG')
const logger = Logging.getLogger('dse-distributed-events')

const PORT = 8099

async function main () {
  // kree4n创建节点后，DSE.enable开启分布式事件能力
  const nodeA = DSE.enable(Kree4n.create('node-a', '新闻直播间'))
  const nodeB = DSE.enable(Kree4n.create('node-b', '新闻订阅者'))

  try {
    nodeA.listen(`tcp://127.0.0.1:${PORT}`)
    nodeB.attach(`tcp://127.0.0.1:${PORT}`)

    await nodeA.start()
    await nodeB.start()

    // 等待Grid发现完成（whenReady：等nodeA出现在Grid）
    await nodeB.whenReady(nodeA, 5000)
    logger.info('[nodeB] Grid发现完成，nodeB已感知nodeA')

    // ── nodeA注册"直播间"（EventEmitter）——"开播" ────────
    const newsroom = new EventEmitter()
    nodeA.register('newsService', newsroom)
    logger.info('[nodeA] 已注册newsService（直播间）')

    // 等待discover完成（订阅前先等发现，确保代理可用）
    await PromiseUtils.delay(100)

    // ── nodeB获取"远程直播间"并订阅news事件 ──────────────
    const newsProxy = nodeB.eventService('newsService')
    newsProxy.on('news', (news) => {
      logger.info(`收到新闻: ${news.headline}`)
    })

    // 等待订阅（collapseListen）完成
    await PromiseUtils.delay(100)

    // ── 广播 ───────────────────────────────────────────
    logger.info('[nodeA] 开始广播...')
    // nodeA广播
    newsroom.emit('news', { headline: 'Kree4JS发布1.0版本' })
    // nodeB驱动nodeA广播
    newsProxy.emit('news', { headline: '分布式事件订阅指南上线' })

    // 等待事件到达nodeB
    await PromiseUtils.delay(100)

    logger.info('DSE示例执行完成')
  } finally {
    await PromiseUtils.delay(100)
    await ExecUtils.quiet(() => nodeB.stop(), logger)
    logger.info(`${nodeB}，已停止`)
    await ExecUtils.quiet(() => nodeA.stop(), logger)
    logger.info(`${nodeA}，已停止`)
  }
}

main().catch((err) => logger.error(err))
