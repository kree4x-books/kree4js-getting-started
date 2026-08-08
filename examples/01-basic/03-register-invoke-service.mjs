// internal
import { ExecUtils } from '@kree4js/commons-lang'
import Logging from '@kree4js/commons-logging'
import Kree4n from '@kree4js/kree4n'

// vars
Logging.setLevel('DEBUG')
const logger = Logging.getLogger('register-invoke-service')

/**
 * 注册不同类型的服务实现，并通过 TCP 让另一个节点调用。
 *
 * 演示内容：
 * - 三种注册方式（callee 上）：
 *   - 对象式服务：register(name, impl)
 *   - 类实例式服务：register(name, instance)（复用一个实例）
 *   - 类构造子注册为服务：registerClass(name, Cls)（每次调用新建实例）
 * - caller 通过 TCP 连接到 callee，调用其开放的服务。
 */
async function main () {
  // ── callee：监听端口，注册四种服务 ───────────────
  const callee = Kree4n.create('node-a')
  callee.listen('tcp://127.0.0.1:8090') // Listen TCP

  // caller：Attach到callee端口
  const caller = Kree4n.create('node-b')
  caller.attach('tcp://127.0.0.1:8090') // Attach TCP

  try {
    await callee.start()
    logger.info('[node-a] 已启动，监听 tcp://127.0.0.1:8090')

    await caller.start()
    logger.info('[node-b] 已启动，已连接到 [node-a]')

    // ── 1. 对象式服务 ─────────────────────────────────
    const calculator = {
      add (a, b) {
        return a + b
      },
      multiply (a, b) {
        return a * b
      }
    }
    callee.register('calc', calculator)
    logger.info('[node-a] 已注册对象式服务: calc')

    // ── 2. 类实例式服务（复用一个实例） ──────────────
    class Greeter {
      hello (name) {
        return `Hello, ${name}! (called At ${new Date().toISOString()})`
      }
    }
    callee.register('greeter', new Greeter())
    logger.info('[node-a] 已注册类实例式服务: greeter')

    // ── 3. 类构造子注册为服务（每次调用新建实例） ────────────
    callee.registerClass('space.greeter', Greeter)
    logger.info('[node-a] 已注册类静态服务: space.greeter')

    // ── caller：通过 TCP 连接 callee 并调用其服务 ─────
    const calc = caller.service('calc')
    const addResult = await calc.add(10, 20)
    logger.info(`[node-b] 调用 [node-a].calc.add(10, 20) = ${addResult}`)

    const greeter = caller.service('greeter')
    const helloResult = await greeter.hello('Kree4JS')
    logger.info(`[node-b] 调用 [node-a].greeter.hello('Kree4JS') = ${helloResult}`)
  } finally {
    // 依次停止，ExecUtils.quiet 吞掉单个 stop 异常，避免一个失败阻塞另一个退出
    await ExecUtils.quiet(() => callee.stop(), logger)
    logger.info(`${callee}，已停止`)
    await ExecUtils.quiet(() => caller.stop(), logger)
    logger.info(`${caller}，已停止`)
  }
}

main().catch((err) => logger.error(err))
