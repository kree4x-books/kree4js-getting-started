# 服务发现：使用WaitPolicy定制服务发现判定策略

> Created By [RV](mailto:rodney.vin@gmail.com), and licensed with Creative Commons "[CC BY-NC-ND 4.0](https://creativecommons.org/licenses/by-nc-nd/4.0/)"

**目的与场景**

在这一章，讲解如何使用 **WhoHasWaitPolicy**，为服务调用**WhoHas-IHave 动态服务查找机制** 设定**截止条件**：根据何种算法、策略，认定收到的IHave 应答，已满足查找条件。

### 一. 概念

**1. 动态服务查找：WhoHas-IHave**

Kree4X的服务调用，完全是动态的，对远端服务的存在性，不做任何假设。

內建基于WhoHas-IHave动态服务查找机制。

服务调用发起时，调用发起者向外广播 **WhoHas**信号：谁可提供 service X？

可提供该服务的节点，以**IHave**信号应答。

**2. 等待策略：WaitPolicy**

服务查找者，发送WhoHas信号，会进入等待，直至收到满意的IHave应答，或者超时。

如何判定收集到IHave应答已满足查找要求，这个算法、策略，被称为WaitPolicy。

详情，参考：[服务动态查找：WhoHas-WaitPolicy-IHave](https://zhuanlan.zhihu.com/p/2038556206382454767)

**2. 设定WaitPolicy：waitWhoHas()**

获取服务存根后，通过`.waitWhoHas(policy)`可设定当前存根的WaitPolicy。

### 二. 示例代码

在下边的示例中，我们将：

- node-a：**服务开放者A**，注册 `sensor.read()`
- node-b：**服务开放者B**，同样注册 `sensor.read()`
- caller：**调用发起者**

**收到任意IHave信号即可**

```javascript
// node-a：注册 sensor
const nodeA = create('node-a')
nodeA.register('sensor', {
  read () {
    return 'read-from-node-a'
  }
})

// node-b：同样注册 sensor
const nodeB = create('node-b')
nodeB.register('sensor', {
  read () {
    return 'read-from-node-b'
  }
})

// 调用发起者
const callerOne = create('caller-one', '等1个提供者')

// 获取服务存根
const sensorOne = callerOne.service('sensor')
// waitWhoHas(one)：至少1个，等待3s超时
sensorOne.waitWhoHas(WhoHasWaitPolicy.one(3000))
const value = await sensorOne.read()
// 被调用的是A或者B，都有可能
```

### 三. 须强调的细节

**1. 首次服务调用，必触发WhoHas-Ihave**

使用服务存根，第一次发起服务调用时，必然触发服务动态发现，从而触发WaitPolicy的执行。

应答了IHave的节点，会被缓存，以备后续使用。

当节点失效时，会从缓存中，被自动移除。

**2. 何时再次触发WhoHas-Ihave？**

缓存的节点失效是，会被从缓存中移除。

当缓存中的节点数，不在满足触发WaitPolicy时，会再次触发一次WhoHas-Ihave动态发现。

**2. 如何判定接收的IHave信号已足够？**

调用`WaitPolicy.isEnough (arrivers:Iterable<iHaveSignal>):boolean`，返回true，则足够。

**3. Wait超时**

WaitPolicy是WhoHasWaitPolicy的基类。

使用WaitPolicy(timeout:number)构造子参数timeout参数可设定等待的毫秒值。

WhoHasWaitPolicy的各种构造方法中，允许指定timeout。

**4. 內建的Policy**

`WhoHasWaitPolicy` 提供以下內建静态工厂方法，按需要的 IHave 应答数量选择：

- `WhoHasWaitPolicy.one(timeout)`：收集到 **1 个** IHave 应答即认定满足。
- `WhoHasWaitPolicy.two(timeout)`：收集到 **2 个** IHave 应答即认定满足。
- `WhoHasWaitPolicy.three(timeout)`：收集到 **3 个** IHave 应答即认定满足。
- `WhoHasWaitPolicy.any(timeout)`：等待满 `timeout` 毫秒，收集**所有** IHave 应答（不设数量阈值）。

### 四. 涉及到的 API

**1. CallerServiceCluster.waitWhoHas：设定WaitPolicy**

```typescript
/**
 * 为服务存根设定 WhoHas 查找的满足判定策略：
 * 收集到多少个 IHave 应答，才认定本次查找已满足需求。
 *
 * @param {WhoHasWaitPolicy} waitPolicy - 满足判定策略（阈值 + 等待时长）。
 * @returns {this} 当前存根，支持链式。
 */
waitWhoHas(waitPolicy): this
```

**2. WhoHasWaitPolicy：满足判定策略**

```typescript
// 收集到 1 个 IHave 即认定满足，最多收集 timeout 毫秒
WhoHasWaitPolicy.one(timeout): WhoHasWaitPolicy
// 收集到 2 个 IHave 即认定满足
WhoHasWaitPolicy.two(timeout): WhoHasWaitPolicy
// 收集到 3 个 IHave 即认定满足
WhoHasWaitPolicy.three(timeout): WhoHasWaitPolicy
// 等满 timeout，收集所有应答
WhoHasWaitPolicy.any(timeout): WhoHasWaitPolicy
```

### 五. 可运行代码

完整示例代码，参见：[03-wait-policy.mjs](../examples/02-advance/03-wait-policy.mjs)

