# DSC：分布式回调，感知远程回调结果

> Created By [RV](mailto:rodney.vin@gmail.com), and licensed with Creative Commons "[CC BY-NC-ND 4.0](https://creativecommons.org/licenses/by-nc-nd/4.0/)"

**目的与场景**

在这一章，讲解**两个NodeJS节点**之间的RPC调用时，如何将NodeJS Callback风格的函数开放为服务，然后在远端调用。

### 一. 概念

**1. DSC**

DSC = Distributed Service Callback，分布式服务回调

**2. Callee**

开放了服务，供被调用的一方，被成为Callee：被调用者。

**3. Caller**

发起RPC服务调用，注册了callback的一方，被成为Caller：调用发起者。

**4. 解决什么问题？**

1. 非async、Promise ，传统的NodeJS Callback风格函数，可以被开放为服务，被远程RPC调用。
2. **Callee**，**可感知** callback函数执行结果：成功，还是失败。

举个例子：

- 商家开放订餐服务，要求留下回访电话（callback）
- 您发起订餐，留下电话号码
- 商家执行订单：制作、送餐、配送
- 商家回访：呼叫您的电话，接通回访成功，接不通回访失败。

### 二. 示例代码

在下边的示例中，我们将：

- nodeA：订餐商家，开放 `restaurant.placeOrder(food, cb)` 服务，执行订单后回调cb，**回访**用户
- nodeB：消费者，发起订餐并留下 `cb`——此cb回调将在 **nodeB本地**执行
- nodeA ：感知回访是否成功

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
      // 执行回访
      await cb(null, `${food} 已送达，现在是回访电话`)   
      console.log('回访成功：消费者已接通')      // 感知：投递成功
    } catch (err) {
      console.log(`回访失败: ${err.message}`)  // 感知：投递失败
    }
  }
})

// 获取服务存根
const orderService = nodeB.service('restaurant')
// 消费者下单
orderService.order('美味的食物', (err, notice) => {
  // 本地代码被商家回调
})

```

### 三. 须强调的细节

**1. 回调在"Caller"本地执行**

回调的函数体始终在Caller节点执行。

服务被调用方**Callee**，只是主动"回访"（触发）它。

回访触发时，回调实际执行的代码、能访问的变量，都是RPC调用发起者**Caller**本地的。

**2. 回调为一次性**

每个回调**被投递一次后自动注销**（临时服务自清理）。

同一次调用里若再次投递（多次触发同一回调），第一次成功后回调已注销，后续投递将失败。

需要多次通知的业务（如进度事件），使用DSE（事件订阅）。

**3. 感知cb成败**

- 被调方**Callee**回调时，调用 `await cb(err, result)`
- 成功：**Caller**注册的Callback函数正常执行，**Callee**收到执行结果
- 失败：**Caller**注册的Callback函数抛出异常，或返回Rejected Promise，**Callee**收到执行结果
- 根据cb成功失败，服务开放者Callee，可重试，或执行异常处理逻辑。

**4. RPC调用本身一切如常**

DSC，本身是一次正常RPC调用，只是最后一个参数是回调函数。

RPC本身，还是普通的服务调用，与Kree4X其他的服务调用并无不同。

RPC调用成功后，Callback才有被回调的机会。

**5. 基于已有Kree4X实例增强**

DSC**不创建**Kree4X实例。

使用Kree4N或者Kree4B实例后，如有需要，使用DSC.enable(kree4x)，向已有Kree4X实例注入DSC能力即可。

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
  // 最后一个参数cb是远程回调（callback(err, result) 风格
  order(food: string, cb: (err: Error|null, result: any) => void) {
    ...
    cb(null, result)          // 回访成功
    cb(new Error('...'))      // 回访失败（err跨节点送达）
  }
})

// 发起方调用：末尾传函数实参，函数体在本地执行
service.order(food, (err, result) => {
  // 在发起方空间执行，err为还原后的Error（或null）
})
```

### 五. 可运行代码

完整示例代码，参见：<a href="../examples/01-basic/15-dsc-distributed-callback.mjs" target="_blank">15-dsc-distributed-callback.mjs</a>