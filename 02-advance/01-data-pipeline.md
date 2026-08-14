# 数据管线：使用Pipeline处理出站入站原始数据

> Created By [RV](mailto:rodney.vin@gmail.com), and licensed with Creative Commons "[CC BY-NC-ND 4.0](https://creativecommons.org/licenses/by-nc-nd/4.0/)"

**目的与场景**

在这一章，讲解如何用 **Pipeline** 在**传输层**对出站/入站的原始数据做加工：打标、观察、过滤、访问控制等。

### 一. 概念

**1. 可传送物：TransferableThing**

Kree4X中，存在一个独立的传输层：Transport。

可以通过传输层传输的，被称为TransferableThing，可传送物。

TransferableThing，定义了可通过Transport传输的数据的基本结构。

详情，参阅：

- [Transport：异构的通信网格](https://zhuanlan.zhihu.com/p/2033129687631802400)
- [可传送物：TransferableThing](https://zhuanlan.zhihu.com/p/2035006431427022978)

**2. Pipeline与Pipe**

Kree4X使用Pipeline模型，构建链式的数据处理管线。

`Pipe<TransferableThing>`，是可注入Kree4X插件体系的基本单元。

**3. ThingIn / ThingOut两条管线**

每个Kree4X节点，包含两条数据处理管线：

- 出站，ThingOut，拦截处理所有的出站方向的Thing。
- 入站，ThingIn，拦截处理所有的入站方向的Thing。

### 二. 示例代码

下边的示例中，我们将：

- nodeA ，监听TCP端口8010，注册 `greet` 服务；
- nodeA，拦截入站数据， 记录日志，执行访问控制，
- NodeA，拦截出站数据，记录日志。
- nodeB，Attach TCP 8010端口
- nodeC，被拉黑，其发出的 **服务调用** 会被nodeA的入站拦截器丢弃，其调用收不到响应，最终超时。

**1. 自定义Pipe**

Pipe继承自 `Extensions.Pipe`，只需实现 `process(thing)`。返回 `thing` 即透传，返回 `null` 即丢弃。

```javascript
import Kree4n from '@kree4js/kree4n'

const { Pipe } = Kree4n.Extensions

// 观察：打印Thing摘要（观察 + 透传），可挂ThingIn / ThingOut
class LogPipe extends Pipe {
  constructor (label) { super(); this.label = label }
  // 处理thing
  process (thing) {
    logger.info(`[${this.label}] type=${thing.typeCode} id=${thing.id} src=${thing.srcId ?? '-'} tag=${thing.options?.traceTag ?? '-'}`)
    return thing
  }
}

// 入站访问控制：黑名单中节点发出的Call直接丢弃
class AccessControlPipe extends Pipe {
  constructor (blocklist) { super(); this.blocklist = blocklist }

  process (thing) {
    // 只拦截服务调用（ServiceCall）
    if (thing.typeCode === 'C' && this.blocklist.has(thing.srcId)) {
      logger.warn(`[AccessControl] DROP Call ${thing.id} from blocked src=${thing.srcId}`)
      return null
    }
    return thing
  }
}
```

**2. 挂载管线并触发**

使用 `node.transport.ports.useThingIn(pipe)` / `useThingOut(pipe)`注册入站和出站数据处理器。

Pipe按**注册顺序**执行，顺序敏感。

```javascript
const blocklist = new Set()

// nodeA：服务方
const nodeA = Kree4n.create('node-a', 'Pipeline server')
nodeA.register('greet', { hello (name) { return `Hello, ${name}! (from node-a)` } })
nodeA.listen('tcp://127.0.0.1:8010')
// 入站记录日志
nodeA.transport.ports.useThingIn(new LogPipe('ThingIn '))            // 先观察
// 入站访问控制
nodeA.transport.ports.useThingIn(new AccessControlPipe(blocklist))   // 再访问控制
// 出站记录日志
nodeA.transport.ports.useThingOut(new LogPipe('ThingOut'))

// nodeB：合法客户端，未在黑名单
const nodeB = Kree4n.create('node-b', 'Pipeline client')
nodeB.attach('tcp://127.0.0.1:8010')

// nodeC：被拉黑客户端
const nodeC = Kree4n.create('node-c', 'Blocked client')
nodeC.attach('tcp://127.0.0.1:8010')

// 加入NodeC到黑名单
blocklist.add(nodeC.id)

// nodeB正常调用
const r1 = await nodeB.service('greet').hello('World')
// r1: "Hello, World! (from node-a)"

// 2) nodeC被拉黑：WhoHas/IHave放行、Call被丢弃 → 无响应 → 调用超时
const greetC = nodeC.service('greet')
greetC.timeout(1500)
await greetC.hello('World')   // 抛出超时错误（约1.5s）
```

### 三. 须强调的细节

**1. 作用层级：传输层vs服务层**

Kree4X中，服务层与传输层，是两个不同的层次。

服务层，提供的是BeforeCall、AfterCall钩子，在Callee端服务被调用前、调用后，可以AOP方式注入通用处理逻辑。

传输层，拦截的是Kree4X的最小可传输单元，TransferableThing。

各种数据可被分门别类，拦截、处理：ServiceCall、ServiceCallResult、BeaconSignal……

**2. AND语义与短路**

任一Pipe返回 `null`/`undefined`，管线立即停止。这条规则两面可用：

- **过滤/访问控制**：`return null` ，数据被丢弃。
- **别忘了Return Thing**：忘了 `return thing` 等价于丢弃，别无意间犯这个错误。

**3.同步执行：`pipe.process(thing)` 是sync的**

传输层拦截时，同步方式执行 `process(thing)`。

注意，即可。

**4. 顺序敏感**

Pipe按注册的顺序执行。

`Log → AccessControl` 会**先记录再做访问控制**。

`AccessControl → Log` 则**只记录幸存者**。

**5. 修改Thing：`options` 可写，`payload` 只读**

`thing.options` 是普通可写对象。

`thing.payload` 是只读getter，不要试图覆盖。

不要操作`thing.payload`，它的内容是动态生成的，来自Thing的其他字段。

**6. 节点级vs全局**

- 节点级：`node.ports.transport.useThingIn(pipe)`，只对该节点的传输层生效（示例用法）。
- 全局：`Kree4n.Ports.useThingIn(pipe)`，登记到全局Ports，之后新建的节点会**拷贝**这些Pipe。已建节点不受影响（拷贝发生在节点构造时）。

**7. 丢弃入站Thing，调用方看到的是“超时”**

ThingIn短路后，框架不会回送任何错误，调用方只是收不到响应、最终被调用超时回收。

若需要“明确拒绝并回送错误”，参考下一章，那是Service Interceptor，服务拦截器的职责。

### 四. 涉及到的API:

**1. 挂载/移除Pipe（节点传输层端口）**

```typescript
/**
 * 注册一个入站Pipe。
 * @param {Pipe<TransferableThing>} pipe - 要加入thingInPipeline的Pipe。
 * @returns {this} 当前实例，支持链式。
 */
useThingIn(pipe: Pipe<TransferableThing>): this

/** 注册一个出站Pipe。 */
useThingOut(pipe: Pipe<TransferableThing>): this

/** 移除一个入站Pipe；未找到返回false。 */
discardThingIn(pipe: Pipe<TransferableThing>): boolean

/** 移除一个出站Pipe。 */
discardThingOut(pipe: Pipe<TransferableThing>): boolean
```

**2. Pipe（抽象处理阶段）**

```typescript
/**
 * 管线的一个处理阶段。
 * @template T
 */
class Pipe<T> {
  /**
   * 处理经过本阶段的Thing。
   * @param {T} data - 待处理数据。
   * @param {...any} args - 额外参数（如传输上下文）。
   * @returns {T|null|undefined} 返回Thing继续；返回null/undefined短路丢弃（AND语义）。
   */
  process(data: T, ...args: any[]): T | null | undefined
}
```

子类化并覆盖 `process` 即可：`class MyPipe extends Kree4n.Extensions.Pipe { process (thing) { ...; return thing } }`。

**3. Pipeline（有序处理链）**

```typescript
class Pipeline<T> {
  constructor(pipeline?: Pipeline<T>)        // 可选：从既有Pipeline拷贝Pipe
  get pipes: Pipe<T>[]                       // 当前Pipe数组（按注册顺序）
  use(...pipes: Pipe<T>[]): this             // 追加Pipe（链式）
  discard(pipe: Pipe<T>): boolean            // 移除Pipe
  has(pipe: Pipe<T>): boolean                // 是否存在
  clean(): void                              // 清空
  process(data: T, ...args: any[]): T | undefined            // 同步处理；任一短路即停
  processAsync(data: T, ...args: any[]): Promise<T | undefined>  // 异步版本
}
```

通常无需直接操作Pipeline——`useThingIn/useThingOut` 已封装。两条管线实例也可通过 `node.transport.ports.thingInPipeline` / `thingOutPipeline` 直接取得。

**4. TransferableThing关键字段**

```typescript
class TransferableThing {
  typeCode: string                              // 种类码：B/W/I/C/R
  srcId: string | undefined                     // 源（创建者）节点ID
  dstId: string | undefined                     // 目标节点ID
  senderId: string | undefined                  // 当前跳发送节点（中继时≠srcId）
  receiverId: string | undefined                // 当前跳接收节点
  seq: number                                   // 节点内自增序号
  hops: string[]                                // 跳数记录
  options: { [key: string]: any } | undefined   // 任意键值，可写
  get payload(): { [key: string]: any }         // 业务载荷，只读
  get id(): string                              // `${typeCode}.${seq}-${srcId}`
  get isAnswerable(): boolean                   // 是否需要应答
}
```

**5. ServiceCall（服务调用，typeCode='C'）**

继承 `TransferableAskThing`（即带应答的请求），是最常见的业务载荷之一。

```typescript
class ServiceCall extends TransferableAskThing {
  typeCode: 'C'                                 // 种类码：C（ServiceCall）
  service: string                               // 服务名
  method: string                                // 方法名
  params: any[]                                 // 调用参数数组（默认 []）

  // 继承自TransferableAskThing：
  get askerId(): string | undefined             // 语义别名 = srcId，发起调用的节点
  get askSeq(): number                          // 语义别名 = seq，节点内自增序号
  get isAnswerable(): boolean                   // 恒为true（需要应答）
}
```

**6. ServiceCallResult（服务调用结果，typeCode='R'）**

继承 `TransferableAnswerThing`（即对某个请求的应答），`typeCode='R'`。其 `ok/value/error` 三者由 `ok` 决定：

- `ok=true`：携带 `value`（成功返回值），`error` 为undefined；
- `ok=false`：携带 `error`（错误对象），`value` 为undefined。

```typescript
class ServiceCallResult extends TransferableAnswerThing {
  typeCode: 'R'                                 // 种类码：R（ServiceCallResult）
  ok: boolean | undefined                       // 是否成功；true→带value，false→带error
  value: any | undefined                        // 成功时的返回值
  error: Error | undefined                      // 失败时的错误对象
  get service(): string | undefined             // 关联serviceCall的service名

  // 关联到被应答的ServiceCall：
  get serviceCall(): ServiceCall | undefined    // 被应答的原始ServiceCall
  get askId(): string | undefined               // 被应答Call的id
  get askerId(): string | undefined             // 发起调用方节点ID（= 原Call的srcId）
  get askSeq(): number | undefined              // 原Call的seq

  // 语义别名：
  get callerId(): string | undefined            // 语义别名 = askerId
  get callSeq(): number | undefined             // 语义别名 = askSeq
  get callId(): string | undefined              // 语义别名 = askId
  get resultSeq(): number                       // 语义别名 = seq（结果自身序号）
  get isAnswerable(): boolean                   // 恒为false（结果是终态）
}
```

### 五. 可运行代码

完整示例代码，参见：<a href="../examples/02-advance/01-data-pipeline.mjs" target="_blank">01-data-pipeline.mjs</a>
