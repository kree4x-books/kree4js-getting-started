// 3rd
import { createServer, connect as netConnect } from 'node:net'
import os from 'node:os'
import path from 'node:path'

// internal
import { ExecUtils, PromiseUtils } from '@kree4js/commons-lang'
import Logging from '@kree4js/commons-logging'
import Kree4N, { Constants, Transports } from '@kree4js/kree4n'

// module vars
Logging.setLevel('DEBUG')
const logger = Logging.getLogger('custom-protocol')

const {
  Attach: { AttachConnection, OutgoingChannel },
  Listen: { IncomingChannel, ListenConnection },
  ConnectionProvider
} = Transports
const { ConnectionMode } = Constants

// 扩展通信协议：提供新的ConnectionProvider，让Kree4X支持新的连接协议。
// 本示例实现一个基于Unix domain socket的进程内直连协议ipc://<pipeName>，同时支持Listen/Attach两种模式：
//   - node.listen('ipc://<pipeName>')：在tmpdir下创建socket文件，等待attach
//   - node.attach('ipc://<pipeName>')：连到该socket文件，建立双向通道
//   - 服务发现、网格、分帧、Tracing全部由Kree4X框架复用，之上直接跑RPC调用
//
// 扩展一个协议需要三个组件：
//   1. ConnectionProvider：声明协议能力（capability/understands），按NetPoint创建连接
//   2. Listen侧Connection + Channel：继承框架基类，负责接收接入
//   3. Attach侧Connection + Channel：继承框架基类，负责发起连接

// ── 连接提供者：声明协议能力，按NetPoint创建连接 ──
class IpcConnectionProvider extends ConnectionProvider {
  /**
   * 提供者的名字。
   *
   * @returns {string} 提供者名字。
   */
  name () {
    return 'IpcConnectionProvider'
  }

  /**
   * 判断能否处理该连接点：仅判断protocol是否为'ipc'，同时支持Listen/Attach。
   *
   * @param {NetPoint} netPoint - 连接点，含URL与连接模式（attach/listen）。
   * @returns {boolean} 能处理返回true。
   */
  understands (netPoint) {
    const protocol = netPoint.protocol.toLowerCase()
    return protocol === 'ipc'
  }

  /**
   * 声明支持的协议名，供框架做能力路由（如协商、转发）。
   *
   * @returns {{ attach: string[], listen: string[] }} 各侧的协议名数组。
   */
  capability () {
    return { attach: ['ipc'], listen: ['ipc'] }
  }

  /**
   * 为连接点创建连接实例：Listen创建服务端连接，Attach创建客户端连接。
   *
   * @param {NetPoint} netPoint - 连接点。
   * @param {Transport} transport - 所属传输实例。
   * @returns {Connection} 连接实例。
   */
  provide (netPoint, transport) {
    if (netPoint.mode === ConnectionMode.Listen) {
      return new IpcListenConnection(transport, netPoint)
    }
    return new IpcAttachConnection(transport, netPoint)
  }
}

// ── 服务端：继承ListenConnection，监听socket文件等待attach ──
class IpcListenConnection extends ListenConnection {
  /**
   * 返回连接类型名（常量字符串）：用于toString/日志，混淆后依然可读。
   *
   * @returns {string} 连接类型名。
   */
  getType () {
    return 'IpcListenConnection'
  }

  /**
   * 是否单帧（mono frame）模式：一次data事件是否恰好是一个完整独立的frame。
   * TCP/IPC是流式协议，可能粘包/拖包，返回false（由框架负责帧重组）。
   *
   * @returns {boolean} 是否单帧模式，此处固定返回false。
   */
  _isMonoFrameSupported () {
    return false
  }

  /**
   * 服务端上"新接入"的事件名。
   *
   * @returns {string[]} 接入事件名列表。
   */
  _getIncomingConnectEvents () {
    return ['connection']
  }

  /**
   * 连接是否存活。
   *
   * @returns {boolean} 此示例中永远为true。
   */
  _isAlive () {
    return true
  }

  /**
   * 创建net server并监听socket文件，返回描述对象。
   *
   * @returns {Promise<{ underlying: import('node:net').Server }>} underlying为net server。
   */
  async _createServer () {
    const sockPath = buildSockPath(this.netPoint.hostname)
    const server = createServer()
    await new Promise((resolve, reject) => {
      server.once('error', reject)
      server.listen(sockPath, resolve)
    })
    logger.info(`[ipc] ${this.nodeId} 监听: ${sockPath}`)
    return { underlying: server }
  }

  // 方法参数是变参...args，来自_getIncomingConnectEvents()的事件被触发时emit的数据
  // 需要一个支持EventEmitter的Underlying，socket已支持直接返回
  _createChannelUnderlying (...args) {
    return args[0]
  }

  /**
   * 把_createChannelUnderlying的返回值包装成IncomingChannel。
   *
   * @param {import('node:net').Socket} channelUnderlying - 底层通道。
   * @returns {IncomingChannel} 服务端信道实例。
   */
  _createChannel (channelUnderlying) {
    return new IpcIncomingChannel(this, channelUnderlying)
  }

  /**
   * 判定连接断开的事件名。
   *
   * @returns {string[]} 断开事件名列表。
   */
  _getBrokenEvents () {
    return ['close', 'end']
  }

  /**
   * 关闭时清理：关闭net server。
   *
   * @param {import('node:net').Server} server - net server。
   * @returns {Promise<void>} 清理完成时resolve。
   */
  async _destroyServer (server) {
    await new Promise(resolve => server.close(resolve))
  }
}

// ── 服务端信道：继承IncomingChannel，通过socket回发数据 ────────
class IpcIncomingChannel extends IncomingChannel {
  /**
   * 返回信道类型名（常量字符串）：用于toString/日志，混淆后依然可读。
   *
   * @returns {string} 信道类型名。
   */
  getType () {
    return 'IpcIncomingChannel'
  }

  /**
   * 信道是否存活：socket未销毁即存活。
   *
   * @returns {boolean} 是否存活。
   */
  _isAlive () {
    return !this.underlying.destroyed
  }

  /**
   * 发送数据：直接写入socket。
   *
   * @param {TransportContext} transportContext - 传输上下文。
   * @param {Uint8Array|string} rawData - 待发送的原始数据。
   * @param {object} [options] - 发送选项。
   * @returns {Promise<void>} 发送完成时resolve。
   */
  async _send (transportContext, rawData, options) {
    const { timeout = 30_000 } = options ?? this._options
    const deferred = PromiseUtils.defer(timeout)
    try {
      const bytes = typeof rawData === 'string' ? new TextEncoder().encode(rawData) : new Uint8Array(rawData)
      this.underlying.write(bytes)
      deferred.resolve()
    } catch (e) {
      deferred.reject(e)
    }
    return deferred.promise
  }

  /**
   * 关闭信道：销毁socket。
   *
   * @returns {void}
   */
  _close () {
    this.underlying.destroy()
  }

  /**
   * 判定信道断开的事件名。
   *
   * @returns {string[]} 断开事件名列表。
   */
  _getBrokenEvents () {
    return ['close', 'end']
  }
}

// ── 客户端：继承AttachConnection，连接socket文件 ────
class IpcAttachConnection extends AttachConnection {
  /**
   * 返回连接类型名（常量字符串）：用于toString/日志，混淆后依然可读。
   *
   * @returns {string} 连接类型名。
   */
  getType () {
    return 'IpcAttachConnection'
  }

  /**
   * 是否单帧（mono frame）模式：一次data事件是否恰好是一个完整独立的frame。
   * TCP/IPC是流式协议，可能粘包/拖包，返回false（由框架负责帧重组）。
   *
   * @returns {boolean} 是否单帧模式，此处固定返回false。
   */
  _isMonoFrameSupported () {
    return false
  }

  /**
   * 连接socket文件，返回底层socket。
   *
   * @returns {Promise<import('node:net').Socket>} 已连接的socket。
   */
  async _connect () {
    const sockPath = buildSockPath(this.netPoint.hostname)
    const socket = netConnect(sockPath)
    await new Promise((resolve, reject) => {
      socket.once('connect', resolve)
      socket.once('error', reject)
    })
    logger.info(`[ipc] ${this.nodeId} 接入: ${sockPath}`)
    return socket
  }

  /**
   * 把_createChannelUnderlying的返回值包装成OutgoingChannel。
   *
   * @param {import('node:net').Socket} channelUnderlying - 底层通道。
   * @returns {OutgoingChannel} 客户端信道实例。
   */
  _createChannel (channelUnderlying) {
    return new IpcOutgoingChannel(this, channelUnderlying)
  }

  /**
   * 判定连接断开的事件名。
   *
   * @returns {string[]} 断开事件名列表。
   */
  _getBrokenEvents () {
    return ['close', 'end']
  }
}

// ── 客户端信道：继承OutgoingChannel，通过socket发送数据 ────
class IpcOutgoingChannel extends OutgoingChannel {
  /**
   * 返回信道类型名（常量字符串）：用于toString/日志，混淆后依然可读。
   *
   * @returns {string} 信道类型名。
   */
  getType () {
    return 'IpcOutgoingChannel'
  }

  /**
   * 信道是否存活：socket未销毁即存活。
   *
   * @returns {boolean} 是否存活。
   */
  _isAlive () {
    return !this.underlying.destroyed
  }

  /**
   * 发送数据：直接写入socket。
   *
   * @param {TransportContext} transportContext - 传输上下文。
   * @param {Uint8Array|string} rawData - 待发送的原始数据。
   * @param {object} [options] - 发送选项。
   * @returns {Promise<void>} 发送完成时resolve。
   */
  async _send (transportContext, rawData, options) {
    const { timeout = 30_000 } = options ?? this._options
    const deferred = PromiseUtils.defer(timeout)
    try {
      const bytes = typeof rawData === 'string' ? new TextEncoder().encode(rawData) : new Uint8Array(rawData)
      this.underlying.write(bytes)
      deferred.resolve()
    } catch (e) {
      deferred.reject(e)
    }
    return deferred.promise
  }

  /**
   * 关闭信道：销毁socket。
   *
   * @returns {void}
   */
  _close () {
    this.underlying.destroy()
  }

  /**
   * 判定信道断开的事件名。
   *
   * @returns {string[]} 断开事件名列表。
   */
  _getBrokenEvents () {
    return ['close', 'end']
  }
}

/**
 * 示例入口：启动listen/attach两个节点，通过ipc://直连完成跨节点RPC调用。
 *
 * @returns {Promise<void>} 调用完成时resolve。
 */
async function main () {
  // node-a：listen侧，注册服务
  const nodeA = Kree4N.create('node-a', '服务端节点')
  // 注入ipc协议提供者，使节点支持ipc://
  nodeA.useConnectionProvider(new IpcConnectionProvider())
  // 以listen模式监听该URL，创建socket文件
  nodeA.listen('ipc://greet')
  nodeA.register('greeter', {
    hello (name) {
      return `Hello ${name}`
    }
  })
  await nodeA.start()
  logger.info('node-a，已就绪')

  // node-b：attach侧，调用服务
  const nodeB = Kree4N.create('node-b', '客户端节点')
  // 注入同一个ipc协议提供者
  nodeB.useConnectionProvider(new IpcConnectionProvider())
  // 以attach模式连接该URL，连上socket文件
  nodeB.attach('ipc://greet')
  await nodeB.start()
  logger.info('node-b，已就绪')

  // 等待网格传播：让两侧发现彼此的服务
  await new Promise(resolve => setTimeout(resolve, 300))

  // node-b通过ipc://直连调用node-a的服务
  const result = await nodeB.service('greeter').hello('ipc-direct')
  logger.info(`[ipc] 跨节点调用成功: ${result}`)

  await ExecUtils.quiet(() => nodeB.stop(), logger)
  await ExecUtils.quiet(() => nodeA.stop(), logger)
  logger.info('全部节点已停止')
}

/**
 * 由管道名生成socket文件路径：放在系统临时目录下。
 *
 * @param {string} pipeName - 连接点中的管道名段。
 * @returns {string} socket文件路径。
 */
function buildSockPath (pipeName) {
  return path.join(os.tmpdir(), `kree4x-${pipeName}.sock`)
}

main().catch((err) => logger.error(err))
