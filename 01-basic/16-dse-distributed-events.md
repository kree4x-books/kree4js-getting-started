# DSE：分布式EventEmitter，支持远程事件通知及回调结果感知

> Created By [RV](mailto:rodney.vin@gmail.com), and licensed with Creative Commons "[CC BY-NC-ND 4.0](https://creativecommons.org/licenses/by-nc-nd/4.0/)"

**目的与场景**

在这一章，讲解任意多个Kree4X节点间的**事件发布与订阅**：

- 一个节点把事件"广播"出去，
- 另一个节点远程"聆听"并响应

与RPC不同，事件是**一对多、异步、单向**的：发布方不关心谁在听，也无需等待处理结果。

### 一. 概念

参阅：[DSE: 事件驱动，分布式EventEmitter服务](https://zhuanlan.zhihu.com/p/2050189269164103625)，概念、理论，解释的都很详细。

简短版，如下。

**1. DSE**

DSE = Distributed Service Events，分布式服务事件。

**2. 解决什么问题？**

1. 把Node.js的 `EventEmitter`（事件发射器）开放为远程服务
2. 广播式通知场景：一个服务向多个订阅者推送同一事件，订阅者各自处理，互不影响。
3. 服务开放者，可触发emit()方法。
4. 所有**远程服务存根，也能触发emit()**方法。事件服务存根不仅能 `on()` 订阅，也能 `emit()` 反向驱动发布端。

### 二. 示例代码

在下边的示例中，我们将：

- nodeA：新闻直播间，开放 `newsService`（一个EventEmitter）作为服务，基于此发布新闻消息
- nodeB：新闻订阅者，获得nodeA `newsService`的本地透明服务存根后，`on('news', ...)` 订阅新闻消息

```javascript
// internal
import { EventEmitter } from '@kree4js/commons-events'
import DSE from '@kree4js/dse'
import Kree4n from '@kree4js/kree4n'

  // kree4n创建节点后，enableDse开启分布式事件能力
  const nodeA = DSE.enable(Kree4n.create('node-a', '新闻直播间'))
  const nodeB = DSE.enable(Kree4n.create('node-b', '新闻订阅者'))

  // nodeA注册直播间（EventEmitter）——"开播"
  const newsroom = new EventEmitter()
  nodeA.register('newsService', newsroom)

  // nodeB获取"远程直播间"并订阅news事件
  const newsProxy = nodeB.eventService('newsService')
  newsProxy.on('news', (news) => {
    logger.info(`收到新闻: ${news.headline}`)
  })

  // nodeA广播
  newsroom.emit('news', { headline: 'Kree4JS发布1.0版本' })

  // NodeB驱动NodeA广播
  newsProxy.emit('news', { headline: '分布式事件订阅指南上线' })
```

### 三. 须强调的细节

**1. 哪些EventEmitter可以开放为服务？**

NodeJS原生EventEmitter，支持。

@kree4js/commons-events的EventEmitter，NodeJS和**浏览器端**，都可用。

详情参阅：[零零碎碎的稀奇古怪之EventEmitter：支持Owner分组管理](https://zhuanlan.zhihu.com/p/2037107293641232612)

其他第三方，必须兼容”NodeJS原生EventEmitter“，才可被开放为服务，否则不保证工作正常。

**2. 开放为服务后，哪些方法在远程可用？**

官方支持：'on', 'emit', 'off'，各种EventEmitter的最小集。

其他的方法，可能可用，但无任何保证。

**3. 订阅广播“事件”，多次接收"通知"**

DSE的事件是**广播**：发布者 `emit` 一次，所有已订阅的订阅者都能收到。

发布者不需要知道有多少订阅者。

**4. 事件订阅是"持久"的**

DSC回调是一次性的，投递后自动注销。

DSE订阅是持久的：`on()` 订阅后，发布者**任意多次** `emit` 同一事件对方都能收到，直到显式 `off()`。

**5. 用 `eventService()` 获取透明服务存根**

普通服务用 `node.service(name)`获取存根。

DSE事件服务使用 `node.eventService(name)` 获取服务存根。

它返回的代理支持 `.on()` / `.off()` 订阅远程事件。

原因：DSE存根内部实现与普通ServiceStub有很大不同(状态保持、故障恢复……)，不得不引入一个独立实现。

**6. 发布者不关心订阅者状态**

发布端 `emit` 时订阅端是否在线、订阅者对消息如何处理，发布端不关心。

**7. 执行策略：Fail-Fast与Fire-And-Forget**

“Fire-And-Forget”：默认的订阅Callback执行策略。

发布者，不关心订阅者是否收到、回调是否成功。

回调失败，不触发“**error**”事件。

Fail-Fast

同步的回调失败，阻止后续回调；异步的回调，使用Promise.all统一执行。

回调失败，触发 “**error**”事件

 **8. 如何保证事件”最终一次到达“**
使用Kafka类消息总线，作为底层的通信信道。

如果使用Kafka，可参阅：《基础篇：使用Kafka协议连接》。

如果确保Kafka**只被**用于DSE，可参阅：《中级篇：传输策略：使用TransportPolicy为服务调用通信协议与信道》


### 四. 涉及到的API

**1. 为Kree4X节点注入DSE能力**

```javascript
enable(kreex)
enableDse(kreex)
```

- 入参 `kreex`：由运行时层（kree4n或kree4b）创建的KreeX实例
- 返回：开启DSE能力的同一KreeX实例（原地增强，幂等）

**2. 注册EventEmitter服务**

```typescript
/**
 * 注册一个服务（KreeX通用方法）。
 *
 * @param {string} serviceName - 服务名。
 * @param {EventEmitter} eventEmitter - 事件服务：EventEmitter实例
 * @param {{[key:string]: any}} [serviceOption] - 服务配置选项。
 * @returns {Service} 创建的服务实例。
 */
register(serviceName, eventEmitter, serviceOption?)
```

`serviceOption.callback`

- 取值：`'fire-and-forget'`（默认）或 `'fail-fast'`

**3. 注册事件服务的语法糖（fireAndForget / failFast）**

```typescript
// 与register() 等价，但固定了callback策略：
nodeA.fireAndForget('newsService', new EventEmitter())   // 策略：fire-and-forget（默认）
nodeA.failFast('newsService', new EventEmitter())        // 策略：fail-fast
```

```typescript
/**
 * 以fire-and-forget / fail-fast策略注册事件服务（等价于register() + callback选项）。
 *
 * @param {string} serviceName - 服务名。
 * @param {EventEmitter} emitter - 事件发射器实例。
 * @param {{[key:string]: any}} [serviceOption] - 其他注册选项（callback由语法糖固定，勿传）。
 * @returns {Service} 创建的服务实例
 */
fireAndForget(serviceName, emitter, serviceOption?)
failFast(serviceName, emitter, serviceOption?)
```

- `register('newsService', emitter)` 默认采用fire-and-forget策略
- 两者差别仅在于**发布事件时，订阅端监听器失败的处理策略**：
  - `fire-and-forget`：发布端不感知订阅端失败——同步/异步失败仅记录日志，不触发 `error` 事件，也不影响其他监听器
  - `fail-fast`：监听器同步失败即中止本次发布并触发 `error` 事件；异步失败汇总后同样触发 `error` 事件

**4. 获取服务存根，订阅事件**

```typescript
// 订阅端：获取远程EventEmitter代理，on() 订阅
const proxy = nodeB.eventService('newsService')
proxy.on('news', (payload) => { ... })
```

- `on` 的回调在**订阅端本地**执行，收到的是发布端 `emit` 时序列化的payload副本

**5. emit事件**

```typescript
// 发布端
newsroom.emit('news', { headline: '...' })

// 远程服务存根NodeB驱动NodeA广播
newsProxy.emit('news', { headline: '...' })
```

- 本地EventEmitter`emit` 事件，远端已订阅者的处理立即触发
- 远程服务代理调用`emit` 事件，远端已订阅者的处理立即触发。触发emit的"远程服务代理"自身如果已订阅，**也会收到通知**。

### 五. 可运行代码

完整示例代码，参见：[16-dse-distributed-events.mjs](../examples/01-basic/16-dse-distributed-events.mjs)