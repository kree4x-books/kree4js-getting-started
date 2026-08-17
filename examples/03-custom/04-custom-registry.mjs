// internal
import { PromiseUtils } from '@kree4js/commons-lang'
import Logging from '@kree4js/commons-logging'
import Kree4N, { Services } from '@kree4js/kree4n'

// module vars
Logging.setLevel('DEBUG')
const logger = Logging.getLogger('custom-registry')

const PORT = 8094

// 扩展服务注册表：提供集中式服务注册及查找能力。
// Kree4X 默认在本地 LocalStore 注册服务，服务发现走网格（Grid.whoHas）。
// 本示例实现一个进程内集中式注册表 mem-registry://<registryName>：
//   - 所有节点通过 setRegistry() 指向同一个注册表 URL，共享同一注册表实例
//   - register() 时服务同步写入注册表（ServiceInfo），caller 从注册表发现服务
//   - 发现路径从网格 (Grid.FindServices) 切换为注册表 (Registry.FindServices)

// ── 集中式注册表：所有节点共享的全局单例 ──────────────
const registryName2Instance = new Map()

// ── 注册表实现：继承 ServiceRegistry，实现增删查 ──────
class MemServiceRegistry extends Services.Registry {
  constructor (registryName) {
    super()
    this._registryName = registryName
    this._name2infos = new Map()
  }

  // 注册服务：register() 时框架会把服务转成 ServiceInfo 后交给 add()
  add (service) {
    const { name, nodeId } = service
    const key = `${name}@${nodeId}`
    const infos = this._name2infos.get(name) ?? []
    if (infos.some(info => `${info.name}@${info.nodeId}` === key)) {
      return false
    }
    infos.push(service)
    this._name2infos.set(name, infos)
    logger.info(`[mem-registry:${this._registryName}] 服务已注册: ${name} @ ${nodeId}`)
    return true
  }

  remove (service) {
    const { name, nodeId } = service
    const infos = this._name2infos.get(name) ?? []
    const next = infos.filter(info => info.nodeId !== nodeId)
    if (next.length === infos.length) {
      return false
    }
    if (next.length === 0) {
      this._name2infos.delete(name)
    } else {
      this._name2infos.set(name, next)
    }
    return true
  }

  removeServices (name) {
    this._name2infos.delete(name)
  }

  hasName (name) {
    return this._name2infos.has(name)
  }

  has (service) {
    const infos = this._name2infos.get(service.name) ?? []
    return infos.some(info => info.nodeId === service.nodeId)
  }

  async findOne (name, filters) {
    const matched = await this.findMany(name, filters)
    return matched[0]
  }

  // 查找并返回指定名称的service清单（框架对filter格式无要求，这里忽略filter）
  findMany (name, filters) {
    return this._name2infos.get(name) ?? []
  }
}

// ── 提供者：识别 mem-registry:// URL，返回共享注册表实例 ──
class MemServiceRegistryProvider extends Services.ServiceRegistryProvider {
  name () {
    return 'MemServiceRegistryProvider'
  }

  understands (registryUrl) {
    return registryUrl.toLowerCase().startsWith('mem-registry://')
  }

  // 同 registryName 的节点返回同一个注册表实例 => 集中式共享
  provide (registryUrl, kreex) {
    const registryName = registryUrl.slice('mem-registry://'.length)
    let registry = registryName2Instance.get(registryName)
    if (registry == null) {
      registry = new MemServiceRegistry(registryName)
      registryName2Instance.set(registryName, registry)
    }
    return registry
  }
}

async function main () {
  // node-a：把服务注册进集中式注册表
  const nodeA = Kree4N.create('node-a', '注册服务方')
  nodeA.useServiceRegistryProvider(new MemServiceRegistryProvider())
  nodeA.setRegistry('mem-registry://shared-bus')
  nodeA.listen(`tcp://127.0.0.1:${PORT}`)
  nodeA.register('greet', {
    hello (name) {
      return `Hello ${name}`
    }
  }, { version: '1.0' })
  await nodeA.start()
  logger.info(`node-a（${nodeA.id}）已就绪`)

  // node-b：同样指向集中式注册表，网格连接 + 注册表发现
  const nodeB = Kree4N.create('node-b', '调用服务方')
  nodeB.useServiceRegistryProvider(new MemServiceRegistryProvider())
  nodeB.setRegistry('mem-registry://shared-bus')
  nodeB.attach(`tcp://127.0.0.1:${PORT}`)
  await nodeB.start()
  logger.info('node-b 已就绪')

  // 等网格互联完成
  await new Promise(resolve => setTimeout(resolve, 300))

  // caller 从注册表发现 node-a 的服务（而非网格 Grid.FindServices）
  const result = await nodeB.service('greet').hello('mem-registry')
  logger.info(`[mem-registry] 跨节点调用成功: ${result}`)

  // 停止前留出在途帧的送达窗口
  await PromiseUtils.delay(100)
  // 停止
  await nodeB.stop()
  await nodeA.stop()
  logger.info('全部节点已停止')
}

main().catch((err) => logger.error(err))
