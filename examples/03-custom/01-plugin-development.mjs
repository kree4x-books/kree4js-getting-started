// internal
import { ExecUtils, PromiseUtils } from '@kree4js/commons-lang'
import Logging from '@kree4js/commons-logging'
import Kree4N from '@kree4js/kree4n'

// module vars
Logging.setLevel('DEBUG')
const logger = Logging.getLogger('plugin-development')

const PORT = 8130
const { GridEvent } = Kree4N.Constants

// 插件 = 一组可复用的节点增强配置，用 usePlugin(plugin) 挂到节点上。
// 插件只需实现三个钩子，由 KreeX 在生命周期中自动调用：
//   - config(kreex)：注册时立即执行，用 kreex 上的扩展点装配能力
//   - start()：kreex.start() 时执行，启动插件自己的资源
//   - stop()：kreex.stop() 时执行，清理插件自己的资源
//
// 下面这个 StatusPlugin 演示三个扩展点：
//   - config：注册 status 服务（任何节点都能远程查询本节点状态）
//   - config：挂入站拦截器（每次到达本节点的调用都会打印日志）
//   - start/stop：订阅/退订网格事件（感知其他节点的动态加入）

// ── 插件：节点状态上报 ────────────────────────
class StatusPlugin {
  constructor (label) {
    this._label = label
    /** @type {import('@kree4js/kree4n').KreeX|undefined} */
    this._kreex = undefined
    this._startedAt = undefined
  }

  config (kreex) {
    this._kreex = kreex
    // 扩展点1：注册服务，远端节点可直接调用查询本节点状态
    kreex.register('status', {
      status: () => ({
        node: kreex.name,
        description: kreex.description,
        uptimeSec: Math.round((Date.now() - (this._startedAt ?? Date.now())) / 1000)
      })
    })
    // 扩展点2：入站拦截器，观察所有到达本节点的调用
    kreex.useInInterceptor(new StatusLogInterceptor(this._label))
    logger.info(`[插件${this._label}] config()：已注册 status 服务与入站拦截器`)
  }

  start () {
    this._startedAt = Date.now()
    // 扩展点3：订阅网格事件，感知节点动态加入/离开。
    // 注意：回调必须显式绑定this（事件系统按Listener实例调用回调，不绑定this）
    const grid = this._kreex?.transport.grid
    this._nodeAddedHandler = (nodeId) => this._onNodeAdded(nodeId)
    this._nodeRemovedHandler = (nodeId) => this._onNodeRemoved(nodeId)
    grid?.on(GridEvent.NodeAdded, this._nodeAddedHandler, this)
    grid?.on(GridEvent.NodeRemoved, this._nodeRemovedHandler, this)
    logger.info(`[插件${this._label}] start()：已订阅网格事件`)
  }

  stop () {
    const grid = this._kreex?.transport.grid
    grid?.off(GridEvent.NodeAdded, this._nodeAddedHandler, this)
    grid?.off(GridEvent.NodeRemoved, this._nodeRemovedHandler, this)
    logger.info(`[插件${this._label}] stop()：已退订网格事件`)
  }

  _onNodeAdded (nodeId) {
    logger.info(`[插件${this._label}] 网格节点加入: ${nodeId}`)
  }

  _onNodeRemoved (nodeId) {
    logger.info(`[插件${this._label}] 网格节点离开: ${nodeId}`)
  }
}

// ── 入站拦截器：打印到达本节点的调用 ──────────────
class StatusLogInterceptor {
  constructor (label) {
    this._label = label
  }

  beforeCall (ctx, cluster, method, params, options) {
    logger.info(`[插件${this._label}] 收到调用: ${cluster.name}.${method}`)
  }
}

async function main () {
  // ── node-a：挂载插件，监听TCP ──
  const nodeA = Kree4N.create('node-a', '主机A')
  nodeA.usePlugin(new StatusPlugin('A'))
  // node-a 独占注册 greet 服务（StatusPlugin 的 status 每个节点都有，greet 只有 node-a 有）
  nodeA.register('greet', {
    hello (name) {
      return `Hello ${name}`
    }
  })
  nodeA.listen(`tcp://127.0.0.1:${PORT}`)
  await nodeA.start()
  logger.info('node-a，已就绪')

  // ── node-b：同样挂载插件，挂接node-a ──
  const nodeB = Kree4N.create('node-b', '主机B')
  nodeB.usePlugin(new StatusPlugin('B'))
  nodeB.attach(`tcp://127.0.0.1:${PORT}`)
  await nodeB.start()
  logger.info('node-b，已就绪（node-a 的插件应打印 网格节点加入）')

  // 等网格事件传播
  await new Promise(resolve => setTimeout(resolve, 200))

  // 1. 调用 status：每个节点都装了 StatusPlugin，service() 按集群选择目标节点（可能落在本地）
  const statusOne = await nodeB.service('status').status()
  logger.info(`[1] node-b 调用 status：${JSON.stringify(statusOne)}`)

  // 2. 调用仅 node-a 注册的 greet：唯一持有者必路由到 node-a（远程），其入站拦截器会打印 收到调用
  const greeting = await nodeB.service('greet').hello('reader')
  logger.info(`[2] node-b 调用 greet：${greeting}`)

  // 3. 动态加入：不带插件的 node-c 加入网格
  const nodeC = Kree4N.create('node-c', '临时节点')
  nodeC.attach(`tcp://127.0.0.1:${PORT}`)
  await nodeC.start()
  logger.info('node-c，已加入（node-a/node-b 的插件应打印 网格节点加入）')

  // 等网格事件传播
  await new Promise(resolve => setTimeout(resolve, 200))

  // 停止前留出在途帧的送达窗口
  await PromiseUtils.delay(100)
  await ExecUtils.quiet(() => nodeC.stop(), logger)
  await ExecUtils.quiet(() => nodeB.stop(), logger)
  await ExecUtils.quiet(() => nodeA.stop(), logger)
  logger.info('全部节点已停止')
}

main().catch((err) => logger.error(err))
