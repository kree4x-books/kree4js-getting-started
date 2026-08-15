// internal
import { ExecUtils, PromiseUtils } from '@kree4js/commons-lang'
import Logging from '@kree4js/commons-logging'

// owned
import Kree4n from '@kree4js/kree4n'

// module vars
Logging.setLevel('INFO')
const logger = Logging.getLogger('data-pipeline')

const { Pipe } = Kree4n.Extensions

// 观察：打印Thing摘要（观察 + 透传），可挂ThingIn / ThingOut
class LogPipe extends Pipe {
  constructor (label) {
    super()
    this.label = label
  }

  process (thing) {
    logger.info(`[${this.label}] type=${thing.typeCode} id=${thing.id} src=${thing.srcId ?? '-'} tag=${thing.options?.traceTag ?? '-'}`)
    return thing
  }
}

// 入站访问控制：黑名单中节点发出的Call直接丢弃（短路 + 丢弃，AND语义）
class AccessControlPipe extends Pipe {
  constructor (blocklist) {
    super()
    this.blocklist = blocklist
  }

  process (thing) {
    // 只拦截服务调用（ServiceCall，typeCode 'C'），放行Beacon/WhoHas/IHave等发现信令
    if (thing.typeCode === 'C' && this.blocklist.has(thing.srcId)) {
      logger.warn(`[AccessControl] DROP Call ${thing.id} from blocked src=${thing.srcId}`)
      return null
    }
    return thing
  }
}

/**
 * 数据管线：使用Pipeline处理出站入站原始数据。
 *
 * - nodeA（监听）：注册greet服务；入站管线=日志+访问控制，出站管线=日志
 * - nodeB（attach）：合法客户端，正常调用
 * - nodeC（attach）：被拉黑客户端，其入站Call被nodeA丢弃 → 无响应 → 调用超时
 *
 * 关键点：
 * - 两条管线：ThingOut（发出前）/ ThingIn（收到后）
 * - AND语义：任一Pipe返回null/undefined即短路
 * - 顺序敏感：Pipe按注册顺序执行
 * - 注册路径：node.transport.ports.useThingIn / useThingOut
 */
async function main () {
  const blocklist = new Set()

  // ── Node A（服务方：监听 + 入站访问控制 + 出/入站日志） ─────
  const nodeA = Kree4n.create('node-a', 'Pipeline server')
  nodeA.register('greet', {
    hello (name) { return `Hello, ${name}! (from node-a)` }
  })
  nodeA.listen('tcp://127.0.0.1:8010')
  // 入站管线（按注册顺序执行，AND语义）：先观察，再访问控制
  nodeA.ports.transport.useThingIn(new LogPipe('ThingIn '))
  nodeA.ports.transport.useThingIn(new AccessControlPipe(blocklist))
  // 出站管线：观察
  nodeA.ports.transport.useThingOut(new LogPipe('ThingOut'))

  // ── Node B（合法客户端，未在黑名单） ─────────────────────
  const nodeB = Kree4n.create('node-b', 'Pipeline client')
  nodeB.attach('tcp://127.0.0.1:8010')

  // ── Node C（被拉黑客户端） ───────────────────────────
  const nodeC = Kree4n.create('node-c', 'Blocked client')
  nodeC.attach('tcp://127.0.0.1:8010')
  blocklist.add(nodeC.id) // 拉黑nodeC：其入站Call会被nodeA丢弃

  try {
    await nodeA.start()
    await nodeB.start()
    await nodeC.start()

    // 1. nodeB正常调用：命中服务 → 返回
    logger.info('--- 1. nodeB正常调用 ---')
    const greetB = nodeB.service('greet')
    const r1 = await greetB.hello('World')
    logger.info(`[nodeB] greet.hello('World') => ${r1}`)

    // 2. nodeC被拉黑：nodeA入站AccessControl丢弃 → 无响应 → 调用超时
    logger.info('--- 2. nodeC被拉黑：nodeA入站丢弃 → 无响应 → 调用超时 ---')
    const greetC = nodeC.service('greet')
    greetC.timeout(1500)
    try {
      await greetC.hello('World')
    } catch (err) {
      logger.warn(`[nodeC] call dropped by nodeA ThingIn pipeline => ${err.message ?? err}`)
    }
  } finally {
    await PromiseUtils.delay(100)
    await ExecUtils.quiet(() => nodeC.stop(), logger)
    await ExecUtils.quiet(() => nodeB.stop(), logger)
    await ExecUtils.quiet(() => nodeA.stop(), logger)
  }
}

main().catch((err) => logger.error(err))
