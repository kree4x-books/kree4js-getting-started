// 3rd
import path from 'node:path'
import { fileURLToPath } from 'node:url'

// internal
import { ExecUtils, PromiseUtils } from '@kree4js/commons-lang'
import Logging from '@kree4js/commons-logging'
import Kree4n, { FileWriter } from '@kree4js/kree4n'
import Trace from '@kree4js/tracing'

// vars
Logging.setLevel('DEBUG')
const logger = Logging.getLogger('tracing')

// Resolve the directory of this module so the SVG output path is computed
// relative to the script location (examples/01-basic).
const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

/**
 * 手工开启Tracing，把一次跨节点服务调用的时间线导出为SVG文件。
 *
 * 演示内容：
 * - 在caller侧对某个服务代理手工开启tracing：service.traceEnabled = true。
 * - 执行一次跨节点调用，框架自动采集CallerServiceCluster.FindServices、
 *   KreeX.Transport.Send/Receive等Action的时间线。
 * - 从kreex的trace系统取出Tracer，用SvgFormatter + kree4n的FileWriter把时间线导出为SVG文件。
 */
async function main () {
  // ── callee：监听端口，注册一个服务 ───────────────
  const callee = Kree4n.create('node-a')
  callee.listen('tcp://127.0.0.1:8090') // Listen TCP

  // ── caller：Attach到callee端口 ──────────────
  const caller = Kree4n.create('node-b')
  caller.attach('tcp://127.0.0.1:8090') // Attach TCP

  try {
    await callee.start()
    logger.info('[node-a] 已启动，监听tcp://127.0.0.1:8090')

    await caller.start()
    logger.info('[node-b] 已启动，已连接到 [node-a]')

    callee.register('calc', {
      add (a, b, ctx) {
        // 获取tracer，开启一个新的逻辑“phase”
        const phase = ctx.tracer?.phase('calc.add')
        // 标记开始处理
        phase?.trace(`Start Handling ${a} + ${b}`, '', 'calc.add.start', 'detail info')
        // 业务操作
        const result = a + b
        // 标记处理结束
        phase?.trace(`Done Handling ${a} + ${b}`, '', 'calc.add.done', 'detail info')
        return result
      }
    })
    logger.info('[node-a] 已注册对象式服务: calc')

    // 获取透明服务代理
    const calc = caller.service('calc')
    // 开启当前服务、下次调用的tracing
    calc.traceEnabled = true
    logger.info('[node-b] 已对calc服务代理手工开启tracing')

    // 调用远程服务
    const addResult = await calc.add(10, 20)
    logger.info(`[node-b] 调用 [node-a].calc.add(10, 20) = ${addResult}`)

    // ── 取出tracer，通过kree4n的FileWriter输出为SVG文件 ──
    const tracer = calc.lastTracer
    const tmpDir = path.join(__dirname, '../../tmp')
    tracer.output(new Trace.SvgFormatter(), new FileWriter(tmpDir, '.svg'), Trace.OutputLevel.INFO)
    logger.info(`[node-a] 已导出tracing时间线到 ${path.join(tmpDir, `${tracer.id}.svg`)}`)
  } finally {
    // 停止前留出在途帧的送达窗口
    await PromiseUtils.delay(100)
    // 依次停止，ExecUtils.quiet吞掉单个stop异常，避免一个失败阻塞另一个退出
    await ExecUtils.quiet(() => callee.stop(), logger)
    logger.info(`${callee}，已停止`)
    await ExecUtils.quiet(() => caller.stop(), logger)
    logger.info(`${caller}，已停止`)
  }
}

main().catch((err) => logger.error(err))
