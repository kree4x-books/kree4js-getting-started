# DSC：分布式回调，感知远程回调结果

> Created By [RV](mailto:rodney.vin@gmail.com), and licensed with Creative Commons "[CC BY-NC-ND 4.0](https://creativecommons.org/licenses/by-nc-nd/4.0/)"

**目的与场景**

Kree4X的DSC，不仅仅是“将NodeJS Callback风格函数开放为RPC服务”的问题。

它与传统的“Callback风格函数”，有很大不同。

它提供一个“**提交任务，获取反馈 → 任务执行，CB回调 → 回调完成，获取结果**”的三阶段交互的模型：

- 第一阶段，RPC调用本身有返回值：RPC调用“**提交任务**”，同时获得“**任务提交成功**”的反馈。
- 第二阶段，Caller提供的cb函数，Callee异步回调：任务执行完毕，Callee可以主动通知Caller，避免Caller轮询。
- 第三阶段，Caller执行cb函数的结果，Callee可以感知与获取

在这一章，讲解**两个NodeJS节点**之间的RPC调用时，如何将NodeJS Callback风格的函数开放为服务，然后在远端调用。

### 一. 概念

**1. DSC**

DSC = Distributed Service Callback，分布式服务回调

**2. Callee**

开放了服务，供被调用的一方，被称为Callee：被调用者。

**3. Caller**

发起RPC服务调用，注册了callback的一方，被称为Caller：调用发起者。

**4. 解决什么问题？**

1. 非async、Promise ，传统的NodeJS Callback风格函数，可以被开放为服务，被远程RPC调用。
2. Caller可RPC方式，调用“NodeJS Callback风格函数”本身。
3. “NodeJS Callback风格函数”执行完毕，可以调用Caller的cb函数
2. **Callee**，**可感知** Caller端cb函数执行结果：成功，还是失败，以及获取返回值。

举个例子：

- 商家开放订餐服务，要求留下回访电话（callback）
- 您发起订餐，留下电话号码
- 商家执行订单：制作、送餐、配送
- 商家回访：呼叫您的电话，接通回访成功，接不通回访失败。

**5. RPC调用本身有返回值**

DSC回调，本质是一次正常RPC调用，服务方法可以照常 `return` 结果：

- Callee的服务方法 `return` 的值，作为RPC调用自身的返回值，回到Caller
- Caller侧 `const result = await service.method(...)` 直接拿到该值

**6. cb的返回值，Callee可感知和使用**

回调函数 `fn(err, result)` 本身也可以 `return` 值：

- 该返回值，经DSC的回传链路跨网回传
- Callee侧 `await cb(err, result)` 后，**获取该返回值**

### 二. 示例代码

在下边的示例中，我们将：

- nodeA：订餐商家，开放 `restaurant.placeOrder(food, cb)` 服务，执行订单后回调cb，**回访**用户
- nodeB：消费者，发起订餐并留下 `cb`——此cb回调将在 **nodeB本地**执行
- nodeA ：感知回访是否成功，并使用`cb`的**返回值**（回访评价）
- RPC调用本身也有**返回值**：订单与评价回给消费者

```javascript
import DSC from '@kree4js/dsc'
import Kree4N from '@kree4js/kree4n'

// 基于Kree4N节点开启DSC能力
const nodeA = DSC.enable(Kree4N.create('node-a', '订餐商家（被调方）'))
const nodeB = DSC.enable(Kree4N.create('node-b', '消费者（发起方）'))

// 商家开放订餐服务：消费者留下电话(callback)，执行订单后回访
nodeA.register('restaurant', {
  async order (food, cb) {
    // 执行订单：制作、送餐、配送...
    ……
    // 回调cb，处理cb结果
    try {
      // 执行回访：await cb()直接返回消费者callback的返回值（无需解包）
      const ack = await cb(null, `${food} 已送达，现在是回访电话`)
      // 感知：投递成功，并使用cb返回值（回访评价）
      console.log(`回访成功：消费者已接通，回访评价=${ack}`)
      // RPC调用本身有返回值：消费者的下单调用将收到此结果
      return { order: food, ack }
    } catch (err) {
      console.log(`回访失败: ${err.message}`)  // 感知：投递失败（callback抛错，await cb()抛出）
    }
  }
})

// 获取服务存根
const orderService = nodeB.service('restaurant')
// 消费者下单：回调在nodeB本地执行；RPC调用本身也有返回值
const rpcResult = await orderService.order('美味的食物', (err, result) => {
  // 本地代码被商家回调
  console.log(`接到商家回访："${result}"`)
  return '满意，五星好评'     // 此返回值经回传链路回到商家（callee），商家可感知并使用
})
console.log(`订单完成：${JSON.stringify(rpcResult)}（RPC调用自身的返回值）`)

```

### 三. 须强调的细节

**1. 回调在"Caller"本地执行**

回调的函数体始终在Caller节点执行。

服务被调用方**Callee**，只是主动"回访"（触发）它。

回访触发时，回调实际执行的代码、能访问的变量，都是RPC调用发起者**Caller**本地的。

**2. 一次性回调**

每个回调**被投递一次后自动注销**。

需要多次通知的业务（如进度事件），使用DSE（事件订阅）。

**3. 感知cb成败**

Callee回调cb时，总是可以获取cb的执行结果：

- 被调方**Callee**回调时，调用 `await cb(err, result)`：
- 成功：**Caller**注册的Callback函数正常执行，`await cb()` **直接返回**其返回值
- 失败：**Caller**注册的Callback函数抛出异常，或返回Rejected Promise，`await cb()` **抛出**该异常

**4. RPC本身调用如常**

DSC，本身是一次正常RPC调用，只是最后一个参数是回调函数。

RPC本身，还是普通的服务调用，与Kree4X其他的服务调用并无不同。

Callee侧，服务实现方法 `return` 结果，Caller侧 `await` 可以获取。

RPC调用成功后，Callback才有被回调的机会。

**5. 基于已有Kree4X实例增强**

DSC**不创建**Kree4X实例。

使用Kree4N或者Kree4B实例后，使用`DSC.enable(kree4x)`，向已有Kree4X实例注入DSC能力即可。

**6. `await cb()` 直接返回Callback的返回值（无需解包）**

`await cb(err, result)` 的返回，由DSC拦截器内部解包，**不需要再取字段**：

- 正常返回：直接得到Callback函数 `return` 的原始值
- Callback抛错或返回Rejected Promise：`await cb()` 抛出该异常（跨网回传还原）

```javascript
// 感知并使用cb返回值
try {
  const ack = await cb(null, notice) // ack即callback的原始返回值
  console.log(`回访评价：${ack}`)
} catch (err) {
  console.log(`回访异常：${err.message}`) // callback抛出的异常
}
```

**7. RPC返回值 vs cb返回值**

两条返回值链路互不干扰：

- **RPC自身的返回值**（订单结果）：从Callee回传到Caller，Caller通过`await service.method()`感知
- **cb的返回值**（回访评价）：从Caller回传到Callee，Callee通过`await cb().value`感知

### 四. 涉及到的API:

**1. 基于Kree4N节点开启DSC（enable）**

```typescript
/**
 * 基于Kree4N或者Kree4B创建的节点,开启DSC（分布式服务回调）能力。
 *
 * @param {KreeX} kreex
 * @returns {KreeX} 开启DSC的节点实例，同一实例。
 */
enable(kreex): KreeX
```

```javascript
import DSC from '@kree4js/dsc'
import Kree4N from '@kree4js/kree4n'

// 基于Kree4N节点开启DSC能力
const nodeA = DSC.enable(Kree4N.create('node-a', '订餐商家（被调方）'))
```

**2. 回调参数形态**

```typescript
// 被调方注册服务：
register('restaurant', {
  // 最后一个参数cb是远程回调（callback(err, result) 风格）
  // 方法可以照常return：作为RPC调用自身的返回值，回到调用发起方
  order(food: string, cb: (err: Error|null, result: any) => any): Promise<Object> {
    ...
    const ack = await cb(null, result)   // 回访成功：ack即callback的return值
    // ack: callback的原始返回值（DSC拦截器已解包；失败则await cb()抛异常）
    cb(new Error('...'))                 // 回访失败（err跨节点送达）
  }
})

// 发起方调用：末尾传函数实参，函数体在本地执行
// callback的return值，经回传链路回到被调方（callee的await cb()）
const rpcResult = await service.order(food, (err, result) => {
  // 在发起方空间执行，err为还原后的Error（或null）
  return anything // cb的返回值，被调方可感知
})
// rpcResult: 服务方法order()的return值（RPC调用自身的返回值）
```

### 五. 可运行代码

完整示例代码，参见：<a href="../examples/01-basic/16-dsc-distributed-callback.mjs" target="_blank">16-dsc-distributed-callback.mjs</a>