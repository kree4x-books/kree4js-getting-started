# 开发插件：使用插件扩充Kree4X

> Created By [RV](mailto:rodney.vin@gmail.com), and licensed with Creative Commons "[CC BY-NC-ND 4.0](https://creativecommons.org/licenses/by-nc-nd/4.0/)"

**目的与场景**

Kree4X提供了各种Ports、Providers机制，允许对Kree4X进行动态配置及能力增强。

而 `usePlugin()` 插件机制，则允许将各种配置代码，集结在一个独立的Plugin插件中，以Plugin为单元进行动态扩展管理。

这一章，将讲解如何开发、封装插件Plugin，并将其注入Kree4X，并动态管理其生命周期。

### 一. 概念

**1. 插件：Plugin**

插件，是一个实现了下述3个生命周期钩子函数的普通对象，将其注入Kree4X后，会被Kree4X在合适的时间节点调用，完成插件的初始化、启动、停止：

- `config(kreex)`：`usePlugin()` 注册时**立即执行**，提供装配能力：注册服务、挂拦截器、订阅事件
- `start()`：`kreex.start()` 时自动调用，插件可在此处完成自身的启动及资源分配、初始化
- `stop()`：`kreex.stop()` 时自动调用，插件可在此处完成自身的停止及资源清理、释放

`config()` ，必须提供；`start()` / `stop()` 可选。

**2. 插件能做什么**

`plugin.config(kreex)` 被调用时，使用传入的 `kreex` 节点实例完成各种静态初始化。

例如：

- `kreex.register(name, obj)`：注册服务
- `kreex.useInInterceptor(...)` / `kreex.useOutInterceptor(...)`：挂服务拦截器
- `kreex.transport.grid.on(...)`：订阅网格事件，感知节点动态加入/离开
- `kreex.ports`：使用Kree4X Ports API，扩展节点能力

**3. 生命周期时序**

```
kreex.usePlugin(plugin)   → 立即执行 plugin.config(kreex)
kreex.start()             → 自动执行 plugin.start()
kreex.stop()              → 自动执行 plugin.stop()
```

插件 `start()` 抛错不会阻断节点启动（仅告警），插件内部须考虑自身启动失败的容错处理。

### 二. 示例代码

在下边的示例中，我们将编写节点状态上报插件 `StatusPlugin`，演示三个扩展点：

- `config`：注册 `status` 服务，任何节点都能远程查询本节点状态
- `config`：挂入站拦截器，打印所有到达本节点的调用
- `start`/`stop`：订阅/退订网格事件，感知其他节点的动态加入

**1. 定义插件**

```javascript
// 插件：节点状态上报
class StatusPlugin {
  constructor (label) {
    this._label = label
  }
  // 静态配置
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
  }

  // 插件启动
  start () {
    const grid = this._kreex.transport.grid
    this._startedAt = Date.now()
    // 扩展点3：订阅网格事件，感知节点动态加入/离开。    
    this._nodeAddedHandler = (nodeId) => this._onNodeAdded(nodeId)
    this._nodeRemovedHandler = (nodeId) => this._onNodeRemoved(nodeId)
    grid.on(GridEvent.NodeAdded, this._nodeAddedHandler, this)
    grid.on(GridEvent.NodeRemoved, this._nodeRemovedHandler, this)
  }

  // 插件停止
  stop () {
    const grid = this._kreex.transport.grid
    grid.off(GridEvent.NodeAdded, this._nodeAddedHandler, this)
    grid.off(GridEvent.NodeRemoved, this._nodeRemovedHandler, this)
  }

  _onNodeAdded (nodeId) {
    logger.info(`[插件${this._label}] 网格节点加入: ${nodeId}`)
  }

  _onNodeRemoved (nodeId) {
    logger.info(`[插件${this._label}] 网格节点离开: ${nodeId}`)
  }
}
```

**2. 注册插件并运行**

```javascript
// node-a：挂载插件，监听TCP
const nodeA = Kree4N.create('node-a', '主机A')
// 注入插件
nodeA.usePlugin(new StatusPlugin('A'))
nodeA.listen(`tcp://127.0.0.1:8130`)
await nodeA.start()

// node-b：同样挂载插件，挂接node-a
const nodeB = Kree4N.create('node-b', '主机B')
// 注入插件
nodeB.usePlugin(new StatusPlugin('B'))
nodeB.attach(`tcp://127.0.0.1:8130`)
await nodeB.start()

// 1. 获取nodeB开放的status服务存根
const status = await nodeB.service('status').status()
// 被调节点的入站拦截器会打印：收到调用: status.status

// 2. node-c 加入网格
const nodeC = Kree4N.create('node-c', '临时节点')
nodeC.attach(`tcp://127.0.0.1:8130`)
await nodeC.start()
// node-a/node-b 的插件会打印：网格节点加入: <node-c的id>
```

### 三. 须强调的细节

**1. `config()` 在注册时立即执行，`usePlugin()` 必须在 `start()` 之前调用**

`kree4X.usePlugin()` 内部，会立即执行 `plugin.config(kreex)`。

先 `start()` 再 `usePlugin()`，插件的start()生命周期方法，不会被调用。

**2. `plugin.start()` 抛错不阻断节点启动**

KreeX 对插件 `start()` 失败只告警（`Plugin start failed`），继续启动其余插件和节点。

插件内部，应提供恰当的容错处理。

**3. `plugin.stop()` 是清理资源的地方**

`kreex.stop()` 会逐个调用插件的 `stop()`。

应在 `plugin.stop()`，完成事件退订、定时器关闭等清理工作。

### 四. 涉及到的API:

**1. Kree4X节点注册插件**

```typescript
/**
 * 注册一个插件，配置并增强此KreeX节点。
 * 插件必须实现 config(kreex)；
 * start()/stop() 可选，由KreeX在启动/停止时自动调用。
 *
 * @param {{
 *   config: (kreex: KreeX) => void,
 *   start?: () => void,
 *   stop?: () => void
 * }} plugin - 要注册的插件。
 * @returns {KreeX} 当前节点实例，支持链式调用。
 */
usePlugin(plugin)
```

**2. 网格事件常量**

```typescript
const GridEvent = {
  NodeAdded: 'node-added',        // 节点被网格发现
  NodeUpdated: 'node-updated',    // 节点信息更新（如TTL刷新）
  NodeRemoved: 'node-removed',    // 节点从网格移除（信标失联判定）
  AdjacentAdded: 'adjacent-added',// 相邻节点直连建立
  AdjacentRemoved: 'adjacent-removed' // 相邻节点直连断开
}

// 获取方式
const { GridEvent } = Kree4N.Constants
```

**3. 网格事件订阅**

```typescript
/**
 * 订阅网格事件。
 *
 * @param {string} eventName - 事件名，GridEvent 中的值。
 * @param {(nodeId: string) => void} callback - 事件回调，参数为节点ID。
 * @param {*} [owner] - 归属标识，用于按owner批量退订。
 * @returns {Grid} 网格实例，支持链式调用。
 */
grid.on(eventName, callback, owner)

/**
 * 退订网格事件。参数与 on() 一致。
 *
 * @param {string} eventName - 事件名。
 * @param {(nodeId: string) => void} callback - 注册时的回调引用。
 * @param {*} [owner] - 注册时的归属标识。
 * @returns {Grid} 网格实例，支持链式调用。
 */
grid.off(eventName, callback, owner)
```

### 五. 可运行代码

完整示例代码，参见：<a href="../examples/03-custom/01-plugin-development.mjs" target="_blank">01-plugin-development.mjs</a>
