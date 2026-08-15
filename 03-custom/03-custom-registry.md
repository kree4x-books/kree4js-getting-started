# 扩展服务注册表：提供集中式服务注册及查找能力

> Created By [RV](mailto:rodney.vin@gmail.com), and licensed with Creative Commons "[CC BY-NC-ND 4.0](https://creativecommons.org/licenses/by-nc-nd/4.0/)"

**目的与场景**

Kree4X 默认采用的是基于WhoHas-IHave传输层能力的动态服务发现机制。

WhoHas-IHave动态发现机制，完全是一种去中心化方案，无服务注册中心、无服务注册表。

同时，Kree4X提供了扩展点，允许开发者提供扩展，使用中心化的服务注册表机制，实现服务的集中式注册与发现。

在这一章，我们将讲解如何实现`ServiceRegistryProvider`、如何向Kree4X注册，扩展集中式服务注册与查找能力。

### 一. 概念

**1. 服务注册表：ServiceRegistry**

服务注册表，是分布式微服务体系中，一种常见的"中心化"解决方案。

各个服务实现者，动态向注册表注册自身。

需要调用别的服务时，动态从注册表查询所需服务。

在微服务网格规模巨大时，集中式的注册与发现，可以规避"去中心化动态广播发现"的耗时与性能问题。

**2. 注册表接口（ServiceRegistry）**

Kree4X定义了服务注册表接口，如下：

```javascript
add(service)            // 向注册表加入一个新的服务
remove(service)         // 从注册表移除指定服务
removeServices(name)    // 按服务名批量移除服务
hasName(name)					  // 是否存在命名服务
has(service)   					// 是否存在指定服务实例
findOne(name, filters)  // 查找单个候选
findMany(name, filters) // 查找全部候选
```

### 二. 示例代码

在下边的示例中，我们将实现一个进程内集中式注册表，并封装到一个ServiceRegistryProvider中。
该Provider，可以理解并处理`mem-registry://<registryName>`格式的Registry地址，并创建ServiceRegistry实例。

- 协议名：`mem-registry`
- 同一 `registryName` 的所有节点共享**同一个注册表实例**（集中式）
- `register()` 的服务自动同步进注册表，caller 从注册表发现并调用

**1. 定义提供者**

```javascript
// 提供者：识别 mem-registry:// URL，返回共享注册表实例
class MemServiceRegistryProvider extends Services.ServiceRegistryProvider {
  // 提供者名字（常量字符串）：日志输出时用于标识该提供者
  name () {
    return 'MemServiceRegistryProvider'
  }

  // 当前Provider是否可处理给定的registryUrl（仅识别 mem-registry:// 前缀）
  understands (registryUrl) {
    return registryUrl.toLowerCase().startsWith('mem-registry://')
  }

  // 根据给定的registryUrl，返回ServiceRegistry实例
  provide (registryUrl, kreex) {
    // 同registryName的节点返回同一个注册表实例 => 集中式共享
    const registryName = registryUrl.slice('mem-registry://'.length)
    let registry = registryName2Instance.get(registryName)
    if (registry == null) {
      registry = new MemServiceRegistry(registryName)
      registryName2Instance.set(registryName, registry)
    }
    return registry
  }
}
```

**2. 实现服务注册表**

```javascript
// 注册表实现：继承 ServiceRegistry，实现增删查
class MemServiceRegistry extends Services.Registry {
  constructor (registryName) {
    super()
    this._registryName = registryName
    this._name2infos = new Map()
  }

  // 将Service实例信息保存
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

  // 将Service实例信息移除
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

  // 移除指定名称的全部service
  removeServices (name) {
    this._name2infos.delete(name)
  }

  // 指定名称是否已有注册
  hasName (name) {
    return this._name2infos.has(name)
  }

  // 指定Service实例是否已注册
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
```

**3. 配置并使用**

```javascript
// node-a：把服务注册进集中式注册表
const nodeA = Kree4N.create('node-a', '注册服务方')
// 注入Provider
nodeA.useServiceRegistryProvider(new MemServiceRegistryProvider())
// 设置注册表地址
nodeA.setRegistry('mem-registry://shared-bus')
nodeA.listen(`tcp://127.0.0.1:${PORT}`)
nodeA.register('greet', {
  hello (name) {
    return `Hello ${name}`
  }
})
await nodeA.start()

// node-b：同样指向集中式注册表
const nodeB = Kree4N.create('node-b', '调用服务方')
// 注入Provider
nodeB.useServiceRegistryProvider(new MemServiceRegistryProvider())
// 设置注册表地址
nodeB.setRegistry('mem-registry://shared-bus')
nodeB.attach(`tcp://127.0.0.1:${PORT}`)
await nodeB.start()

// caller 从注册表发现 node-a 的服务（而非网格 Grid.FindServices）
const result = await nodeB.service('greet').hello('mem-registry')
// Hello mem-registry
```


### 三. 须强调的细节

**1. `setRegistry()` 与 `useServiceRegistryProvider()` 的时机**

必须在kree4x.start()前完成Provider注入，及注册表地址设置

- `useServiceRegistryProvider(provider)`：注入ServiceProvider
- `setRegistry(url)`：设置当前节点使用的服务注册表地址

### 四. 涉及到的API:

**1. ServiceRegistryProvider 基类**

```typescript
/**
 * 服务注册表提供者：为注册表 URL 提供 ServiceRegistry 实例。
 */
class ServiceRegistryProvider {
  /**
   * 提供者的名字。
   * @returns {string}
   */
  name(): string

  /**
   * 判断能否处理该注册表 URL。
   * @param {string} registryUrl - 注册表 URL。
   * @returns {boolean} 能处理返回 true。
   */
  understands(registryUrl: string): boolean

  /**
   * 为注册表 URL 创建注册表实例。
   * @param {string} registryUrl - 注册表 URL。
   * @param {KreeX} kreex - 所属节点实例。
   * @returns {ServiceRegistry} 注册表实例。
   * @abstract
   */
  provide(registryUrl: string, kreex: KreeX): ServiceRegistry
}
```

**2. ServiceRegistry 抽象接口**

```typescript
/**
 * 服务注册表：服务注册与查找。
 * register()/unregister() 时框架调用增删；caller 发现调用查找。
 */
class ServiceRegistry {
  add(service: ServiceInfo): boolean
  remove(service: string|ServiceInfo): boolean
  removeServices(name: string): void
  hasName(name: string): boolean
  has(service: string|ServiceInfo): boolean
  findOne(name: string, filters?: object): Promise<ServiceInfo|undefined>|ServiceInfo|undefined
  findMany(name: string, filters?: object): Promise<ServiceInfo[]|undefined>|ServiceInfo[]|undefined
}
```

**3. 节点配置注册表**

```typescript
/**
 * 设置服务注册表 URL 与选项。
 * 必须在 start() 之前调用。
 *
 * @param {string} url - 注册表 URL。
 * @param {object} [options] - 注册表配置选项。
 * @returns {KreeX} 当前节点实例，支持链式调用。
 */
setRegistry(url, options?)

/**
 * 注册一个服务注册表提供者。
 * 等价于 kreex.ports.service.useServiceRegistryProvider(provider)。
 *
 * @param {ServiceRegistryProvider} serviceRegistryProvider - 注册表提供者。
 * @param {boolean} [asDefault] - 是否设为默认提供者。
 * @returns {KreeX} 当前节点实例，支持链式调用。
 */
useServiceRegistryProvider(serviceRegistryProvider, asDefault?)
```

### 五. 可运行代码

完整示例代码，参见：<a href="../examples/03-custom/03-custom-registry.mjs" target="_blank">03-custom-registry.mjs</a>