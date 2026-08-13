# 服务发现：使用WaitPolicy定制服务发现判定策略

> Created By [RV](mailto:rodney.vin@gmail.com), and licensed with Creative Commons "[CC BY-NC-ND 4.0](https://creativecommons.org/licenses/by-nc-nd/4.0/)"

**目的与场景**

在这一章，讲解如何使用 **ServiceFindWaitPolicy**，为服务调用**WhoHas-IHave动态服务查找机制** 设定**截止条件**：根据何种算法、策略，认定收到的IHave应答，已满足查找条件。

### 一. 概念

**1. 动态服务查找：WhoHas-IHave**

Kree4X的服务调用，完全是动态的，对远端服务的存在性，不做任何假设。

內建基于WhoHas-IHave动态服务查找机制。

服务调用发起时，调用发起者向外广播 **WhoHas**信号：谁可提供service X？

可提供该服务的节点，以**IHave**信号应答。

**2. 等待策略：WaitPolicy**

服务查找者，发送WhoHas信号，会进入等待，直至收到满意的IHave应答，或者超时。

如何判定收集到IHave应答已满足查找要求，这个算法、策略，被称为WaitPolicy。

详情，参考：[服务动态查找：WhoHas-WaitPolicy-IHave](https://zhuanlan.zhihu.com/p/2038556206382454767)

**2. 设定WaitPolicy：waitServiceFind()**

获取服务存根后，通过`.waitServiceFind(policy)`可设定当前存根的WaitPolicy。

### 二. 示例代码

在下边的示例中，我们将：

- node-a：**服务开放者A**，注册 `sensor.read()`
- node-b：**服务开放者B**，同样注册 `sensor.read()`
- caller：**调用发起者**

**收到任意IHave信号即可**

```javascript
// node-a：注册sensor
const nodeA = create('node-a')
nodeA.register('sensor', {
  read () {
    return 'read-from-node-a'
  }
})

// node-b：同样注册sensor
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
// waitServiceFind(one)：至少1个，等待3s超时
sensorOne.waitServiceFind(ServiceFindWaitPolicy.one(3000))
const value = await sensorOne.read()
// 被调用的是A或者B，都有可能
```

### 三. 须强调的细节

**1. 首次服务调用，必触发WhoHas-Ihave**

使用服务存根，第一次发起服务调用时，必然触发服务动态发现，从而触发WaitPolicy的执行。

应答了IHave的节点，会被缓存，以备后续使用。

当节点失效时，会从缓存中，被自动移除。

**2. 何时再次触发WhoHas-Ihave？**

缓存中的节点不足（不再满足WaitPolicy的容忍阈值）时，会**补充性触发**一次WhoHas-Ihave动态发现，合并缺失节点，同时保留缓存中存活的节点引用。

**3. 如何判定接收的IHave信号已足够？**

调用`ServiceFindWaitPolicy.isEnough (arrivers:Iterable<string>):boolean`，返回true，则足够。

候选为**节点id**（IHave应答的节点、缓存中的服务节点），语义统一，见缓存复用与补充发现。

**4. Wait超时**

WaitPolicy是ServiceFindWaitPolicy的基类。

使用WaitPolicy(timeout:number)构造子参数timeout参数可设定等待的毫秒值。

ServiceFindWaitPolicy的各种构造方法中，允许指定timeout。

**5. 內建的Policy**

`ServiceFindWaitPolicy` 提供以下內建静态工厂方法，按需要的IHave应答数量选择：

- `ServiceFindWaitPolicy.one(timeout)`：收集到 **1个** IHave应答即认定满足。
- `ServiceFindWaitPolicy.two(timeout)`：收集到 **2个** IHave应答即认定满足。
- `ServiceFindWaitPolicy.three(timeout)`：收集到 **3个** IHave应答即认定满足。
- `ServiceFindWaitPolicy.any(timeout)`：等待满 `timeout` 毫秒，收集**所有** IHave应答（不设数量阈值）。

### 四. 涉及到的API

**1. CallerServiceCluster.waitServiceFind：设定WaitPolicy**

```typescript
/**
 * 为服务存根设定WhoHas查找的满足判定策略：
 * 收集到多少个IHave应答，才认定本次查找已满足需求。
 *
 * @param {ServiceFindWaitPolicy} waitPolicy - 满足判定策略（阈值 + 等待时长）。
 * @returns {this} 当前存根，支持链式。
 */
waitServiceFind(waitPolicy): this
```

**2. ServiceFindWaitPolicy：满足判定策略**

```typescript
// 收集到1个IHave即认定满足，最多收集timeout毫秒
ServiceFindWaitPolicy.one(timeout): ServiceFindWaitPolicy
// 收集到2个IHave即认定满足
ServiceFindWaitPolicy.two(timeout): ServiceFindWaitPolicy
// 收集到3个IHave即认定满足
ServiceFindWaitPolicy.three(timeout): ServiceFindWaitPolicy
// 等满timeout，收集所有应答
ServiceFindWaitPolicy.any(timeout): ServiceFindWaitPolicy
```

### 五. 可运行代码

完整示例代码，参见：[03-wait-policy.mjs](../examples/02-advance/03-wait-policy.mjs)

