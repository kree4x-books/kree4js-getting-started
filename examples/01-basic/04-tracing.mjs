// 3rd
import path from 'node:path'
import { fileURLToPath } from 'node:url'

// internal
import { ExecUtils } from '@kree4js/commons-lang'
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
 * 手工开启 Tracing，把一次跨节点服务调用的时间线导出为 SVG 文件。
 *
 * 演示内容：
 * - 在 caller 侧对某个服务代理手工开启 tracing：service.traceEnabled = true。
 * - 执行一次跨节点调用，框架自动采集 CallerServiceCluster.FindServices、
 *   KreeX.Transport.Send/Receive 等 Action 的时间线。
 * - 从 kreex 的 trace 系统取出 Tracer，用 SvgFormatter + kree4n 的 FileWriter 把时间线导出为 SVG 文件。
 */
async function main () {
  // ── callee：监听端口，注册一个服务 ───────────────
  const callee = Kree4n.create('node-a')
  callee.listen('tcp://127.0.0.1:8090') // Listen TCP

  // ── caller：Attach 到 callee 端口 ──────────────
  const caller = Kree4n.create('node-b')
  caller.attach('tcp://127.0.0.1:8090') // Attach TCP

  try {
    await callee.start()
    logger.info('[node-a] 已启动，监听 tcp://127.0.0.1:8090')

    await caller.start()
    logger.info('[node-b] 已启动，已连接到 [node-a]')

    callee.register('calc', {
      add (a, b, ctx) {
        // 获取 tracer，开启一个新的逻辑“phase”
        const tracer = ctx.tracer?.phase('calc.add')
        // 标记开始处理
        tracer?.trace(`Start Handling ${a} + ${b}`, '', 'calc.add.start', 'detail info')
        // 业务操作
        const result = a + b
        // 标记处理结束
        tracer?.trace(`Done Handling ${a} + ${b}`, '', 'calc.add.done', 'detail info')
        return result
      }
    })
    logger.info('[node-a] 已注册对象式服务: calc')

    // 获取透明服务代理
    const calc = caller.service('calc')
    // 开启当前服务、下次调用的tracing
    calc.traceEnabled = true
    logger.info('[node-b] 已对 calc 服务代理手工开启 tracing')

    // 调用远程服务
    const addResult = await calc.add(10, 20)
    logger.info(`[node-b] 调用 [node-a].calc.add(10, 20) = ${addResult}`)

    // ── 取出 tracer，通过 kree4n 的 FileWriter 输出为 SVG 文件 ──
    const tracer = calc.lastTracer
    const tmpDir = path.join(__dirname, '../../tmp')
    tracer.output(new Trace.SvgFormatter(), new FileWriter(tmpDir, '.svg'), Trace.OutputLevel.INFO)
    logger.info(`[node-a] 已导出 tracing 时间线到 ${path.join(tmpDir, `${tracer.id}.svg`)}`)
  } finally {
    // 依次停止，ExecUtils.quiet 吞掉单个 stop 异常，避免一个失败阻塞另一个退出
    await ExecUtils.quiet(() => callee.stop(), logger)
    logger.info(`${callee}，已停止`)
    await ExecUtils.quiet(() => caller.stop(), logger)
    logger.info(`${caller}，已停止`)
  }
}

main().catch((err) => logger.error(err))
