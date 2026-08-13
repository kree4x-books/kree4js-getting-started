# 服务重试：设置调用重试策略，自动重试，自动Tracing

> Created By [RV](mailto:rodney.vin@gmail.com), and licensed with Creative Commons "[CC BY-NC-ND 4.0](https://creativecommons.org/licenses/by-nc-nd/4.0/)"

**目的与场景**

在生产环境中，服务调用，失败是常态。

例如，服务重启中、网络抖动、瞬时过载……。

在这一章，讲解如何为服务调用设置**重试策略**：调用失败时自动重试，直到成功或耗尽次数。

Kree4X支持调用重试，同时还默认支持了**自动Tracing**。

最后一次重试时，系统自动开启调用链路追踪，使用Tracing系统自动跟踪调用过程。

关于Tracing的能力，参阅：[追踪：KreeX Tracing](https://zhuanlan.zhihu.com/p/2036394167438415089)

### 一. 概念

**1. 总调用次数：times**

通过服务存根的retry()接口，设定服务调用，允许总执行次数。

`serviceStub.retry(times, interval)` ， `times` 表示**总调用次数**。

`times`是包含首次调用在内的**总次数**，而非失败后重试几次。

```javascript
serviceStub.retry(3, 200) // 总共最多调用3次（首次 + 2次重试），间隔200ms
```

**2. 重试策略: Retrier**

默认的 `retry(times, interval)` 是**固定间隔**（FixedInterval）的一个语法糖。

等同于:`retry(new FixedInterval(times,interval))`。

可使用 `Retrier` 配置多种重试策略：

- 固定间隔：每次重试间隔相同
- 固定退避（fixedBackoff）：固定间隔 + 随机抖动，分散瞬时故障压力
- 指数退避（exponentialBackoff）：间隔指数增长，缓解持续过载
- 线性退避（linearBackoff）：间隔线性增长
- 因子递增（factorIncrease）：间隔按倍数增长
- 摆动间隔（shuttleInterval）：间隔在范围内摆动

Retrier的详情，参阅：[零零碎碎的稀奇古怪之Retrier](https://zhuanlan.zhihu.com/p/2036809040123147326)

**3. 自动Tracing**

Kree4X，默认关闭全局Tracing，但自动开启“服务调用失败重试”，支持自动Tracing。

原因只有一个，性能。

**最后一次重试会自动开启Tracing**，调用最终失败时，能通过Tracer可查阅最后一次尝试的完整调用栈、时间线。


### 二. 示例代码

在下边的示例中，我们模拟一个**不稳定服务**：

- node-a：注册两个服务
  - `broken`：永远失败（模拟宕机）
  - `flaky`：前2次调用失败，第3次成功（模拟启动中）
- node-b：调用方，设置不同的重试策略，观察重试行为

**1. 搭建拓扑**

```javascript
// 不稳定服务存根：前2次失败、第3次成功，可重置计数
function createFlakyService () {
  const stub = {
    calls: 0,
    ping () {
      stub.calls++
      if (stub.calls <= 2) throw new Error('still warming up')
      return 'pong'
    },
    reset () { stub.calls = 0 }
  }
  return stub
}

const flaky = createFlakyService()
const nodeA = create('node-a', 'Unstable provider')
nodeA.register('broken', { ping () { throw new Error('always broken') } })
nodeA.register('flaky', flaky)
nodeA.listen('tcp://127.0.0.1:8060')

const nodeB = create('node-b', 'Retry caller')
nodeB.attach('tcp://127.0.0.1:8060')

await nodeA.start()
await nodeB.start()
```

**2. 无重试：调用直接失败**

未设置重试策略时，一次失败即抛错：

```javascript
const broken = nodeB.service('broken').timeout(5000)
try {
  await broken.ping()
} catch (e) {
  // 调用失败
}
```

**3. 固定间隔重试：retry(times, interval)**

对 `flaky` 设置 `retry(3, 200)`：最多3次总调用，间隔200ms。前2次失败自动重试，第3次成功：

```javascript
flaky.reset()
const flakyFixed = nodeB.service('flaky').timeout(5000)
flakyFixed.retry(3, 200)
const pongFixed = await flakyFixed.ping()  // pong，服务端共收到3次调用
```

**4. Retrier实例：指数退避**

`Retrier` 提供若干静态工厂方法，直接传入实例即可：

```javascript
import { Retrier } from '@kree4js/commons-retrier'

flaky.reset()
const flakyBackoff = nodeB.service('flaky').timeout(5000)
flakyBackoff.retry(Retrier.exponentialBackoff(100).times(3))
const pongBackoff = await flakyBackoff.ping()  // pong
```

间隔依次约为100ms → 200ms → 400ms，指数增长。

**5. 回调形式：链式配置**

`retry(callback)` 传入一个回调，在回调中链式配置 `Retrier`。

```javascript
flaky.reset()
const flakyChain = nodeB.service('flaky').timeout(5000)
flakyChain.retry(r => r.times(3).fixedBackoff(100, 0))
const pongChain = await flakyChain.ping()  // pong
```

采用固定退避：间隔固定100ms + 0ms抖动（`fixedBackoff(interval, jitter)`）。

**6. 清除重试策略**

`retry()` 无参调用，则会清除已设置的重试策略。

```javascript
const brokenNoRetry = nodeB.service('broken').timeout(5000)
brokenNoRetry.retry()  // 清除，等价于不重试
try {
  await brokenNoRetry.ping()
} catch (e) {
  // 调用失败，不再自动重试
}
```

**7. 自动Tracing**

最后一次重试，自动开启Tracing。

调用结束后，从服务存根的 `lastTracer` 属性取Tracer，查看完整的调用链路：

```javascript
flaky.reset()
const flakyTrace = nodeB.service('flaky').timeout(5000)
flakyTrace.retry(3, 200)
const pongTrace = await flakyTrace.ping()  // pong，3次尝试

const tracer = flakyTrace.lastTracer
const actions = Array.from(tracer._timeline, t => t.action)
// Tracer.Construct → FindServices.Start → FindServices.Done → _Invoke.Start → ...
```

Tracer时间线完整记录了最后一次尝试的每个阶段：服务查找、候选选定、调用发起、结果归约等。

### 三. 须强调的细节

**1. times是总调用次数，不是重试次数**

`retry(3, 200)` = 首次 + 2次重试，最多3次总调用。

服务端实际接收的调用次数，可通过服务端计数观察。

**2. 成功即停止**

调用成功，重试不执行。

重试策略，只在**失败时**生效。

**3. 重试间隔vs调用超时**

服务调用，默认超时30s。可使用`serviceStub.timeout(ms)` 调整。

重试间隔应小于服务调用超时，否则重试没有意义。

**4. 自动Tracing只在最后一次重试开启**

- 前N次失败尝试：不开启Tracing
- 最后一次尝试，自动开启Tracing

最终失败时，Tracer中保留了完整的调用过程。

**5. 失败不一定需要重试**

重试适合**瞬时故障**：重启中、网络抖动、过载。

若服务持续不可用（如宕机、协议不匹配），重试只会浪费资源，此时Fail-Fast才是常识。

**6. 幂等性**

重试意味着同一调用可能执行多次。

**服务方法应具备幂等性、或者原子性**（或至少可安全重复执行），对非原子性的服务，多次重试可能造成副作用：例如，重复下单、重复扣款……。

### 四. 涉及到的API

**1. 设置重试策略**

```typescript
/**
 * 清除重试策略（等价于不重试）。
 *
 * @returns {this} 当前存根，支持链式。
 */
retry(): this

/**
 * 固定间隔重试。
 *
 * 注意：times是总调用次数，不是重试次数。
 * 例如retry(3, 200)表示最多3次总调用，间隔200ms。
 *
 * @param {number} times - 总调用次数（含首次尝试）。
 * @param {number} [interval] - 重试间隔（毫秒），默认固定间隔。
 * @returns {this} 当前存根，支持链式。
 */
retry(times: number, interval?: number): this

/**
 * 使用Retrier实例（可配置退避、超时等）。
 *
 * @param {Retrier} retrier - 配置好的Retrier实例。
 * @returns {this} 当前存根，支持链式。
 */
retry(retrier: Retrier): this
```

**2. 设置服务调用超时**

```typescript
/**
 * 设置服务调用的超时时间（毫秒）。
 *
 * @param {number} [ms=30000] - 超时时间，默认30000。
 * @returns {this} 当前存根，支持链式。
 */
serviceStub.timeout(ms?): this
```

**3. Retrier静态工厂**

```typescript
// 常用静态工厂，返回配置好的Retrier实例
Retrier.times(n)                    // 最多n次
Retrier.fixedInterval(ms)           // 固定间隔
Retrier.fixedBackoff(ms, jitter)    // 固定退避（间隔+抖动）
Retrier.linearBackoff(inc, jitter)  // 线性退避
Retrier.factorIncrease(factor)      // 因子递增
Retrier.exponentialBackoff(jitter)  // 指数退避
Retrier.shuttleInterval(step, jitter) // 摆动间隔
Retrier.infinite()                  // 无限次数（配合timeout使用）
```

**4. Retrier实例方法**

```typescript
// 链式配置
retrier.times(n).fixedInterval(ms)
retrier.name('name')          // 命名，便于日志识别
retrier.taskTimeout(ms)       // 单次调用超时，默认2s
retrier.timeout(ms)           // 全部重试总超时，默认120s
retrier.noTimeout()           // 禁用总超时

// 事件监听
retrier.onStart(fn)           // 开始
retrier.onRetry(fn)           // 一次尝试开始
retrier.onSuccess(fn)         // 一次尝试成功
retrier.onFailure(fn)         // 一次尝试失败
retrier.onTimeout(fn)         // 总超时
retrier.onTaskTimeout(fn)     // 单次超时
retrier.onMaxRetries(fn)      // 达到最大次数
retrier.onStop(fn)            // 手动停止
retrier.onCompleted(fn)       // 全部结束
```

### 五. 可运行代码

完整示例代码，参见：[12-retry-policy.mjs](../examples/02-advance/12-retry-policy.mjs)