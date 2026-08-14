# 服务集群：使用ReducePolicy合并多目标节点响应数据

> Created By [RV](mailto:rodney.vin@gmail.com), and licensed with Creative Commons "[CC BY-NC-ND 4.0](https://creativecommons.org/licenses/by-nc-nd/4.0/)"

**目的与场景**

在这一章，讲解如何使用 **ReducePolicy**，把多目标节点返回的多个 `ServiceCallResult` **归约合并**为一个结果：一次调用，调用者只需一个结果。

### 一. 概念

**1. 为什么需要归约：N个结果，只可保留一个 **

使用SelectPolicy完成候选服务选定后，框架会自动对每个选定的服务发起调用。

无论单次服务调用成功与否，都会得到一个服务调用结果 `ServiceCallResult`。N次调用，将产生N个 `ServiceCallResult`。

然而从服务调用者的视角来看，N个结果并不合适——一次调用，调用者只需要一个结果。

**2. 归约策略：ReducePolicy**

将N个 `ServiceCallResult` 化简为一个 `ServiceCallResult` 的过程，被称为**结果归约**（Result Reduction）。

而将调用结果归约时使用的策略、算法，被称为**归约策略**（ReducePolicy）。

归约策略通过存根的 `serviceStub.reduce(policy)` 设定。

详情，参阅：[归约结果：ReducePolicy](https://zhuanlan.zhihu.com/p/2038687011071119813)

**3. 默认策略**

默认策略是 **ReduceFirst**，即"先到先得，先响应先采用"。

这在绝大多数场景下都是合适的。

**4. Select-Reduce组合使用**

SelectPolicy决定调用**哪些**节点，ReducePolicy决定如何**合并**它们的响应。

两者组合，可实现类似Map-Reduce的动态服务集群机制，例如：

- `SelectAll` + `ReduceAvgNumber`：让所有节点同时执行，取平均值。
- `SelectAll` + `ReduceBest`：让所有节点同时执行，取最优结果（如调用多个AI模型推理，取最优解）。

### 二. 示例代码

在下边的示例中，我们将：

- node-a / node-b / node-c：3个服务节点，注册同名 `sensor` 服务，分别返回10 / 20 / 30
- caller：**调用发起者**，`SelectAll` 全选后依次演示不同归约策略

**1. 注册服务，获取存根，全选目标**

```javascript
// node-a / node-b / node-c：注册同名sensor服务，返回10 / 20 / 30
nodeA.register('sensor', { read () { return 10 } })
nodeB.register('sensor', { read () { return 20 } })
nodeC.register('sensor', { read () { return 30 } })

// 调用发起者，获取服务存根
const caller = create('caller')
const sensor = caller.service('sensor')
// 归约需要多个目标，先全选
sensor.select(new SelectPolicy.SelectAll())
```

**2. 取单个结果的归约策略**

```javascript
// ReduceFirst：取第一个结果，不论调用成功还是失败
sensor.reduce(new ReducePolicy.ReduceFirst())
await sensor.read()   // 10

// ReduceFirstSuccess：取第一个成功的结果, 失败的调用自动被跳过
sensor.reduce(new ReducePolicy.ReduceFirstSuccess())
await sensor.read()   // 10
```

**3. 数值聚合归约策略**

```javascript
// ReduceMinNumber：取最小值
sensor.reduce(new ReducePolicy.ReduceMinNumber())
await sensor.read()   // 10

// ReduceMaxNumber：取最大值
sensor.reduce(new ReducePolicy.ReduceMaxNumber())
await sensor.read()   // 30

// ReduceSumNumber：求和
sensor.reduce(new ReducePolicy.ReduceSumNumber())
await sensor.read()   // 60

// ReduceAvgNumber：求平均
sensor.reduce(new ReducePolicy.ReduceAvgNumber())
await sensor.read()   // 20
```

**4. 用comparer择优/择劣**

`ReduceBest`/`ReduceWorst` 需要一个比较函数 `comparer(a, b)`（返回负数表示a更优），用于排序挑选：

```javascript
// ReduceBest：comparer认为"更好"的结果（数值最大）
sensor.reduce(new ReducePolicy.ReduceBest((a, b) => b - a))
await sensor.read()   // 30

// ReduceWorst：comparer认为"更差"的结果（数值最小）
sensor.reduce(new ReducePolicy.ReduceWorst((a, b) => b - a))
await sensor.read()   // 10
```

**5. 自定义ReducePolicy**

实现 `ReducePolicy.ReducePolicy` 的子类，覆盖 `reduce(results)`，即可注入自定义策略。以下示例取结果序列的中位数：

```javascript
// 自定义ReducePolicy：取结果序列的中位数
class ReduceMedianNumber extends ReducePolicy.ReducePolicy {
  reduce (results) {
    if (results.length === 0) return undefined
    // 过滤出成功的数值结果，排序后取中位数
    const values = results
      .filter(r => r.ok && typeof r.value === 'number')
      .map(r => r.value)
      .sort((a, b) => a - b)
    if (values.length === 0) return results[0]
    const mid = Math.floor(values.length / 2)
    return values.length % 2 === 0
      ? { ok: true, value: (values[mid - 1] + values[mid]) / 2 }
      : { ok: true, value: values[mid] }
  }
}

// 注入自定义策略
sensor.reduce(new ReduceMedianNumber())
await sensor.read()   // 20（10/20/30的中位数）
```

> `ReducePolicy` 从 `@kree4js/kree4n` 命名空间导出：`import { ReducePolicy } from '@kree4js/kree4n'`。

### 三. 须强调的细节

**1. 归约的前提：多目标选择**

`reduce()` 只有在 `select()` 选中**多个**节点时才真正发挥作用。

单目标选择（如默认 `SelectFirst`）只有一个结果，归约实际返回原值。

**2. 返回undefined表示"无结果"**

`ReduceFirstSuccess` 在全部失败时返回 `undefined`。

自定义ReducePolicy若无法归约，也应返回 `undefined`，表示本次归约没有结果。

**3. 数值策略要求成功且为数值**

`ReduceMinNumber`/`ReduceMaxNumber`/`ReduceSumNumber`/`ReduceAvgNumber` 只统计**成功**（`ok=true`）且 `value` 为数值的结果。若没有符合条件的数值，将返回失败结果。

**4. ReduceBest/ReduceWorst必须提供comparer**

`ReduceBest`/`ReduceWorst` 的构造参数是必填的 `comparer` 比较函数，不能省略。它定义了什么算"更好"：`ReduceBest` 取comparer认为更优者，`ReduceWorst` 取更差者。

**5. Select-Reduce与不确定性管理**

通过组合使用Select-Reduce，可以把分布式编程中最棘手的"不确定性"管理，转化为可配置、可推理的策略选择。例如 `SelectAll` + `ReduceBest` 可实现"质量择优"。

### 四. 涉及到的API:

**1. 设定归约策略：`serviceStub.reduce()`**

```typescript
/**
 * 为服务存根设定结果归约策略。
 *
 * @param {ReducePolicy} reducePolicy - 归约策略（决定如何把多个调用结果归约为一个）。
 * @returns {this} 当前存根，支持链式。
 */
reduce(reducePolicy): this
```

**2. ReducePolicy：归约策略基类**

```typescript
/**
 * 把一组服务调用结果归约为一个结果。
 */
class ReducePolicy {
  /**
   * @param {ServiceCallResult[]} results - 多个目标节点的调用结果。
   * @returns {ServiceCallResult|undefined} 归约后的结果。
   */
  reduce(results: ServiceCallResult[]): ServiceCallResult | undefined
}
```

**3. 內建的归约策略实现**

| 类名 | 作用 |
|------|------|
| `ReduceFirst` | 取第一个结果，不论成功/失败。 |
| `ReduceFirstSuccess` | 取第一个成功（`ok=true`）的结果；全失败返回 `undefined`。 |
| `ReduceFirstFailure` | 取第一个失败（`!ok`）的结果。 |
| `ReduceMinNumber(numberProp?)` | 取成功结果中数值的最小值。 |
| `ReduceMaxNumber(numberProp?)` | 取成功结果中数值的最大值。 |
| `ReduceSumNumber(numberProp?)` | 求所有成功数值之和。 |
| `ReduceAvgNumber(numberProp?)` | 求所有成功数值之平均。 |
| `ReduceBest(comparer, prop?)` | 用comparer排序，取最优的一个结果。 |
| `ReduceWorst(comparer, prop?)` | 用comparer排序，取最差的一个结果。 |

> `numberProp` 是可选的对象属性路径JSON Pointer、JSON Path：如 `'price.total'`，用于从结果对象中提取字段。

### 五. 可运行代码

完整示例代码，参见：<a href="../examples/02-advance/05-reduce-policy.mjs" target="_blank">05-reduce-policy.mjs</a>
