# 服务集群：使用SelectPolicy选择目标节点

> Created By [RV](mailto:rodney.vin@gmail.com), and licensed with Creative Commons "[CC BY-NC-ND 4.0](https://creativecommons.org/licenses/by-nc-nd/4.0/)"

**目的与场景**

在这一章，讲解如何使用 **SelectPolicy**，为服务集群的调用**选择目标节点**：在完成 WhoHas-IHave 服务动态发现后，从发现的服务节点群中，挑选出 1 到 N 个节点以备调用。

### 一. 概念

**1. 服务集群：ServiceCluster**

这里,应该是我们第一次引入“**服务集群**”的概念。

Kree4X 中，多个节点可以注册**同名服务**。这些提供了同名服务的节点，共同构成一个**服务集群**（ServiceCluster）。

我们一直讲的“服务存根”，实际就是“**服务集群**”的透明代理。

详情，参阅：[服务集群：ServiceCluster](https://zhuanlan.zhihu.com/p/2038360335300695397)

**2. 服务选择：SelectPolicy**

调用发起者通过 `Kree4X.service(name)` 得到服务存根后，可以发起服务调用。

一次服务调用，能发现的服务节点，来自于WhoHas-IHave服务动态发现机制。

一次服务调用，从已经发现的节点中，最终选择哪些服务节点作为调用目标，由 **SelectPolicy** 决定。

这个挑选的过程，被称为**服务选择**：Service Selection。

具体的选择算法，被称为**选择策略**：Select Policy。

详情，参阅：[服务选择与SelectPolicy](https://zhuanlan.zhihu.com/p/2038606515528062421)

**3. 单目标 vs 多目标**

Kree4X，并不限制一次服务调用可以实际调用的目标服务的个数。

如果SelectPolicy执行的结果是多个节点，则会对选中的每个节点发起调用，调用的多个结果，需要使用**ReducePolicy**归约为“**1**”，下章再讲。

- **单目标选择**：`SelectFirst`/`SelectLoop`/`SelectRandom`/`SelectSticky`等选择策略，选择的结果是“**1**”个节点。
- **多目标选择**：`SelectTop(number)`/`SelectAll`等选择策略，选择的结果是多个节点。

**4. 默认策略**

默认使用的 SelectPolicy 是 **SelectFirst**（取候选的第一个节点）。

但这并不总是合适：

- 若调用者在网格中**分布均匀**，每个调用者都使用 SelectFirst，整体上看负载大致均衡。
- 若调用者**分布不均衡**，SelectFirst 会导致负载堆积到少数节点，此时使用**SelectLoop**或**SelectRandom**较好。
- 若服务**有状态**，期望一次调用后始终与该服务节点保持会话，应使用 **SelectSticky**。

### 二. 示例代码

在下边的示例中，我们将：

- node-a / node-b / node-c：3 个服务节点，注册同名 `sensor` 服务，分别返回 10 / 20 / 30
- caller：**调用发起者**，依次演示不同选择策略

> 节点创建、连接、启动、停止等样板操作从略，只聚焦**选择策略**的用法。

**1. 注册服务，获取存根**

```javascript
// node-a / node-b / node-c：注册同名 sensor 服务，返回 10 / 20 / 30
nodeA.register('sensor', { read () { return 10 } })
nodeB.register('sensor', { read () { return 20 } })
nodeC.register('sensor', { read () { return 30 } })

// 调用发起者，获取服务存根
const caller = create('caller')
const sensor = caller.service('sensor')
sensor.waitWhoHas(WhoHasWaitPolicy.three(5000))
```

> **如何获得候选节点**：通过 `waitWhoHas(WhoHasWaitPolicy.three(5000))` 等待收集到 **3 个**提供者。
>
> 这样存根的候选就是这 3 个节点，`select` 只是从这 3 个里挑选。

**2. 单目标选择策略**

每个策略演示前，都重新获取 `sensor` 服务存根（类型都是服务存根，只是设定的选择策略不同），并 `waitWhoHas(three)` 等满 3 个提供者：

```javascript
// SelectFirst：始终选第一个节点（等满 3 个，始终命中 node-a）
let sensor = caller.service('sensor')
sensor.waitWhoHas(WhoHasWaitPolicy.three(5000))
sensor.select(new SelectPolicy.SelectFirst())
await sensor.read()   // 10，落在 node-a

// SelectLoop：轮询选择，从 3 个候选中依次挑选
sensor = caller.service('sensor')
sensor.waitWhoHas(WhoHasWaitPolicy.three(5000))
sensor.select(new SelectPolicy.SelectLoop())
await sensor.read()   // 10（node-a）
await sensor.read()   // 20（node-b）
await sensor.read()   // 30（node-c）

// SelectRandom：随机选择，从 3 个候选中随机挑一个
sensor = caller.service('sensor')
sensor.waitWhoHas(WhoHasWaitPolicy.three(5000))
sensor.select(new SelectPolicy.SelectRandom())
await sensor.read()   // 随机命中某个节点

// SelectSticky：首次选定后，后续尽量复用同一节点
sensor = caller.service('sensor')
sensor.waitWhoHas(WhoHasWaitPolicy.three(5000))
sensor.select(new SelectPolicy.SelectSticky(1))
await sensor.read()   // 首次选定某个节点
await sensor.read()   // 后续复用同一节点
```

**3. 多目标选择策略（默认ReducePolicy是First）**

```javascript
// SelectTop(2)：取前 2 个节点发起调用，结果用默认 ReduceFirst 归约
sensor = caller.service('sensor')
sensor.waitWhoHas(WhoHasWaitPolicy.three(5000))
sensor.select(new SelectPolicy.SelectTop(2))
await sensor.read()

// SelectAll：全选所有节点发起调用
sensor = caller.service('sensor')
sensor.waitWhoHas(WhoHasWaitPolicy.three(5000))
sensor.select(new SelectPolicy.SelectAll())
await sensor.read()
```

**4. 自定义 SelectPolicy**

实现 `SelectPolicy.SelectPolicy` 的子类，覆盖 `select(candidates, ...)`，即可注入自定义策略。以下示例按最近响应时间选择最快节点：

```javascript
// 自定义 SelectPolicy：按最近响应时间选最快节点
class FastestResponsePolicy extends SelectPolicy.SelectPolicy {
  constructor (howMany = 1) {
    super(howMany)
    this._responseTimes = new Map() // nodeId → lastResponseTime
  }

  // 记录响应时间，通常由拦截器在 afterCall 中调用
  recordResponseTime (nodeId, time) {
    this._responseTimes.set(nodeId, time)
  }

  select (candidates, ctx, methodName, params, options) {
    if (candidates.length === 0) return undefined
    // 按上次响应时间排序（快者优先），无记录的排最后
    const scored = candidates
      .map(c => ({ candidate: c, time: this._responseTimes.get(c) ?? Infinity }))
      .sort((a, b) => a.time - b.time)
    return scored.slice(0, this.howMany).map(s => s.candidate)
  }
}

// 注入自定义策略
const fastestPolicy = new FastestResponsePolicy(1)
fastestPolicy.recordResponseTime('node-a', 50)
fastestPolicy.recordResponseTime('node-b', 30) // 最快
fastestPolicy.recordResponseTime('node-c', 100)
sensor = caller.service('sensor')
sensor.waitWhoHas(WhoHasWaitPolicy.three(5000))
sensor.select(fastestPolicy)
await sensor.read()   // 落在 node-b（响应最快）
```

> `SelectPolicy` 从 `@kree4js/kree4n` 命名空间导出：`import { SelectPolicy } from '@kree4js/kree4n'`。

### 三. 须强调的细节

**1. 候选来源：WhoHas-IHave 动态发现**

`select()` 的候选集来自 WhoHas-IHave 动态发现机制。

动态发现的IHava应答节点，作为candidates候选者，交给 `SelectPolicy.select(candidates)` 去挑选。

设 `WhoHasWaitPolicy.three()` ，发现**3 个**候选者，则SelectPolicy只能从中选择。

首次调用后发现的候选者，会被缓存，后续直接复用。

**2. 多目标需要足够候选**

`SelectTop(number)` 等策略要求候选节点数不小于指定的 `number`。

候选不足时，会导致动态发现过程失败，服务调用抛出异步异常。

**3. 多目标搭配 ReducePolicy**

多目标选择会发起多次调用，产生多个结果。

调用者只需一个结果，因此必须配合 **ReducePolicy** 归约（见下一章）。

不显式配置，默认 `ReduceFirst` 。

**4. Sticky 的会话粘性**

`SelectSticky` 首次选中一个节点后，后续调用尽量复用同一节点，直到其失效。

适合有状态服务（如会话保持）。

注意：`SelectSticky`仅保证始终选中同一个服务节点，如果此服务节点开放了多个同名服务，或者开放的是CallService(每次调用创建新实例)，则不能保证多次调用的是同一个服务实例。

**5. 网格变化清理缓存**

网格节点增删时，`SelectSticky`/`SelectLoop` 等有内部状态（索引、粘性节点）的策略，会调用清理内部缓存的对应节点，避免选择已失效节点。

### 四. 涉及到的API:

**1. 设定选择策略：`serviceStub.select()`**

```typescript
/**
 * 为服务存根设定目标节点选择策略。
 *
 * @param {SelectPolicy} selectPolicy - 选择策略（决定本次调用落到哪些候选节点）。
 * @returns {this} 当前存根，支持链式。
 */
select(selectPolicy): this
```

**2. SelectPolicy：选择策略基类**

```typescript
/**
 * 从候选节点群中选择本次调用的目标节点。
 */
class SelectPolicy {
  /**
   * @param {number} [howMany] - 选择目标节点数量，默认 1。
   */
  constructor(howMany?: number)

  /**
   * 从候选节点中挑选目标。
   *
   * @param {Service[]} candidates - 候选节点数组。
   * @param {ServiceClusterCallContext} [clusterCallContext] - 调用上下文。
   * @returns {Service[]|undefined} 选中的目标节点数组。
   */
  select(candidates: Service[], clusterCallContext?: ServiceClusterCallContext): Service[] | undefined
}
```

**3. 內建的选择策略实现**

| 类名 | 作用 |
|------|------|
| `SelectFirst` | 始终选第一个候选节点。 |
| `SelectLoop(howMany=1)` | 轮询，按序依次选择，支持环绕取数。 |
| `SelectRandom(howMany=1)` | 随机选择指定数量的节点。 |
| `SelectSticky(howMany, picker?)` | 首次选择后，后续尽量复用同一节点；候选不足时用 `picker`（默认随机）补齐。 |
| `SelectTop(howMany=1)` | 取候选的前 N 个节点。 |
| `SelectAll` | 全选所有候选节点（`howMany=全部`）。 |

### 五. 可运行代码

完整示例代码，参见：[04-select-policy.mjs](../examples/02-advance/04-select-policy.mjs)
