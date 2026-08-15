# 扩展服务注册表：提供集中式服务注册及查找能力

> Created By [RV](mailto:rodney.vin@gmail.com), and licensed with Creative Commons "[CC BY-NC-ND 4.0](https://creativecommons.org/licenses/by-nc-nd/4.0/)"

**目的与场景**

Kree4X 默认

在本地 `LocalStore` 注册服务，服务发现走网格（`Grid.whoHas`）。本章讲**扩展**：如何实现一个 `ServiceRegistryProvider`，提供集中式的服务注册与查找能力，把发现路径从网格切换到注册表。

### 一. 概念

**1. 注册表在 Kree4X 里的位置**

| 组件 | 默认实现 | 职责 |
|------|---------|------|
| `LocalStore` | 内置 | 本节点注册的服务实例（callee 侧） |
| `Grid.whoHas` | 内置 | 通过网格广播发现"谁有某服务"（caller 侧） |
| `ServiceRegistry` | 可扩展 | 集中式注册表：`register()` 同步登记，caller 从注册表查找 |

三者关系：`register()` 的服务**同时**写入本地 `LocalStore` 与注册表；caller 调用时，**一旦节点配置了注册表（`setRegistry()`），发现路径就切换为注册表**，不再依赖网格广播。

**2. 注册表接口（ServiceRegistry）**

```javascript
add(service)            // register() 时框架把服务转成 ServiceInfo 后调用
remove(service)         // unregister() 时调用
removeServices(name)    // 按服务名成批移除
hasName(name) / has(service)   // 是否存在
findOne(name, filters)  // 查找单个候选
findMany(name, filters) // 查找全部候选（caller 发现走这里）
```

注册表里存的是 **`ServiceInfo`**（而非服务实例）：`{ name, nodeId, version, description, options }`。

**3. 发现流程切换**

```
未配置注册表：caller → Grid.whoHas → 网格广播 → 候选节点
配置注册表：   caller → Registry.findMany → 注册表查询 → 候选节点
```

caller 拿到候选后，无论哪种路径，都得到 `nodeId` 列表，再经由既有传输连接发起调用——**传输部分完全复用**。

### 二. 示例代码

在下边的示例中，我们将实现一个进程内集中式注册表 `mem-registry://<busName>`：

- 协议名：`mem-registry`
- 同一 `busName` 的所有节点共享**同一个注册表实例**（集中式）
- `register()` 的服务自动同步进注册表，caller 从注册表发现并调用

**1. 定义提供者**

```javascript
// 提供者：识别 mem-registry:// URL，返回共享注册表实例
class MemServiceRegistryProvider extends Services.ServiceRegistryProvider {
  name () {
    return 'MemServiceRegistryProvider'
  }

  understands (registryUrl) {
    return registryUrl.toLowerCase().startsWith('mem-registry://')
  }

  // 同 busName 的节点返回同一个注册表实例 => 集中式共享
  provide (registryUrl, kreex) {
    const busName = registryUrl.slice('mem-registry://'.length)
    let registry = registryName2Instance.get(busName)
    if (registry == null) {
      registry = new MemServiceRegistry(busName)
      registryName2Instance.set(busName, registry)
    }
    return registry
  }
}
```

**2. 定义注册表**

```javascript
// 注册表实现：继承 ServiceRegistry，实现增删查
class MemServiceRegistry extends Services.Registry {
  constructor (busName) {
    super()
    this._busName = busName
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
    logger.info(`[mem-registry:${this._busName}] 服务已注册: ${name} @ ${nodeId}`)
    return true
  }

  // 发现：caller 调用时框架调用 findMany(name, { waitPolicy, ...options })
  async findMany (name, filters = {}) {
    const { waitPolicy, ...rest } = filters
    const query = () => (this._name2infos.get(name) ?? []).filter(info => this.__match(info, rest))
    let matched = query()
    while (true) {
      // 等待足够候选或超时（waitPolicy 由框架传入，如 WaitPolicyAtLeastOne）
      const enough = waitPolicy?.isEnough(matched) ?? true
      const timeup = waitPolicy?.isTimeup() ?? true
      if (enough || timeup) {
        break
      }
      await new Promise(resolve => setTimeout(resolve, 50))
      matched = query()
    }
    return matched
  }
}
```

**3. 配置并使用**

```javascript
// node-a：把服务注册进集中式注册表
const nodeA = Kree4N.create('node-a', '注册服务方')
nodeA.useServiceRegistryProvider(new MemServiceRegistryProvider())
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
nodeB.useServiceRegistryProvider(new MemServiceRegistryProvider())
nodeB.setRegistry('mem-registry://shared-bus')
nodeB.attach(`tcp://127.0.0.1:${PORT}`)
await nodeB.start()

// caller 从注册表发现 node-a 的服务（而非网格 Grid.FindServices）
const result = await nodeB.service('greet').hello('mem-registry')
// Hello mem-registry
```

运行输出要点：

```
[mem-registry:shared-bus] 服务已注册: greet @ 01KZZGBNXHVJ3GVHSHK4C1KVGH
node-a（01KZZGBNXHVJ3GVHSHK4C1KVGH）已就绪
node-b 已就绪
[mem-registry] 跨节点调用成功: Hello mem-registry
全部节点已停止
```

### 三. 须强调的细节

**1. `setRegistry()` 与 `useServiceRegistryProvider()` 的时机**

- `setRegistry(url)`：声明本节点使用注册表；**必须在 `start()` 之前调用**
- `useServiceRegistryProvider(provider)`：注册提供者；同样须在 `start()` 之前
- `start()` 时框架执行注册表初始化：`provider.understand(url)` 匹配 → `provider.provide(url, kreex)` 建实例 → 把 `LocalStore` 已有的服务全部补登记进注册表

**2. 集中式与分布式的差别**

- 本示例的 `provide()` 对同一 busName 返回**同一个实例**（集中式注册表）
- 若希望每个节点持有独立注册表副本（分布式同步），`provide()` 每次返回新实例即可，但需自行实现节点间同步

**3. `findMany()` 的 filters 陷阱**

框架调用 `findMany(name, { waitPolicy, ...options })`——`options` 里混有**框架调用选项**（如 `retries`），它们不是过滤条件。示例中的 `__match()` 只匹配 `ServiceInfo` 固有字段与注册时的 `options`，其余键一律忽略，否则查询永远为空：

```javascript
__match (info, filters) {
  for (const [key, value] of Object.entries(filters)) {
    if (['name', 'nodeId', 'version', 'description'].includes(key)) {
      if (info[key] !== value) return false
    } else if (key in (info.options ?? {})) {
      if (info.options[key] !== value) return false
    }
  }
  return true
}
```

**4. `findMany()` 的 waitPolicy 语义**

- 框架传入 `waitPolicy`（如 `WaitPolicyAtLeastOne`，默认等待 `timeout/3`，最短 2 秒）
- `waitPolicy.isEnough(candidates)`：候选是否足够（阈值）
- `waitPolicy.isTimeup()`：等待是否超时
- 注册表实现应：**候选不足且未超时则等待重查，超时则返回现有候选**

**5. 节点间仍需传输连接**

注册表只解决**"谁有服务"**（发现），不解决**"怎么连"**（传输）：caller 拿到 `nodeId` 后，仍需与目标节点建立传输连接（本示例用 TCP listen/attach）。`LocalServiceRegistryProvider`（`kreex://` 协议）是框架预留的本地注册表占位，尚未实现完整语义。

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

**4. ServiceInfo**

```typescript
/**
 * 注册表里的服务条目。
 */
class ServiceInfo {
  name: string          // 服务限定名
  nodeId: string        // 服务所在节点 ID
  description?: string  // 描述
  version?: string      // 版本
  options?: object      // 注册时的附加选项（可作过滤条件）
}
```

### 五. 可运行代码

完整示例代码，参见：<a href="../examples/03-custom/03-custom-registry.mjs" target="_blank">03-custom-registry.mjs</a>