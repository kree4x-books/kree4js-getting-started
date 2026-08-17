# 无返回服务调用：发送即忘，不关心远程是否执行及结果

> Created By [RV](mailto:rodney.vin@gmail.com), and licensed with Creative Commons "[CC BY-NC-ND 4.0](https://creativecommons.org/licenses/by-nc-nd/4.0/)"

**目的与场景**

在上一章，我们讲解了如何注册并调用服务：调用方发起调用，等待被调用方执行完毕，获取调用结果。

但是，“**获取调用结果**”，这个需求，不是每个人都需要的。

实际生产环境中，还有一类调用不需要任何结果：

- 上报一条日志
- 发送一次进度报告
- ……

此类调用，我们只关心“**调用请求是否执行**”，至于结果，**无所谓**。

在这一章，我们讲解在Kree4X中符合发起无返回结果的服务调用。

### 一. 概念

**1. 无返回调用：No-Response Call**

无返回调用，是一种发送即忘（Fire-and-Forget）的服务调用方式：

- 调用方发起调用后，立即返回，不等待被调用方执行完毕
- 被调用方执行对应方法，但不回发任何调用结果
- 调用方不关心远程方法，是否执行、是否成功、结果是什么。

**2. `_`前缀约定**

规则，很简单，服务存根，调用远程方法时，原有方法名前附加`_`前缀，此次调用即为**“无返回调用”**。

例如：

- 远程方法是`collector.log('msg')`
- 以`collector._log('msg')`方式调用，即是无返回调用。

**3. 无返回，等于仅请求**

"无返回"指的是：仅发送服务请求，不等待返回调用结果。

服务发起后，仍会向Callee发送服务请求。

服务请求，发送成功，此次调用即成功。

### 二. 无返回服务调用

在下边的示例中，我们将：

- 创建两个服务节点，并通过tcp互相连接
- 一个节点，注册开放一个"日志收集"服务
- 另外一个节点，分别发起普通调用与无返回调用，对比两者的差异

```javascript
import Kree4n from '@kree4js/kree4n'

// callee：监听端口，注册服务
const callee = Kree4n.create('node-a')
callee.listen('tcp://127.0.0.1:8104')

// caller：Attach到callee端口
const caller = Kree4n.create('node-b')
caller.attach('tcp://127.0.0.1:8104')

await callee.start()
await caller.start()

// 日志收集服务：log() 无返回值
const collector = {
  log (message) {
    // 只记录，不返回任何值
  }
}
callee.register('collector', collector)

// 创建服务存根
const collectorStub = caller.service('collector')

// 普通调用：方法名不带'_'，等待Callee执行结果
await collectorStub.log('hello')

// 无返回调用：方法名以'_'开头，调用即发，不等待callee调用结果
await collectorStub._log('hello')
```

### 三. 须强调的细节

**1.`_xxxx()`调用时， Callee试图返回结果给Caller，是无效的**

“无返回”，是一种框架层行为，和服务的具体实现无关。

即使服务实现，提供了返回值，也会被无差别抛弃。

Caller发起的任何`_`的方法调用，都被认为是发送即忘的。

Callee端方法，即使返回了结果，也会被直接抛弃，不会被Callee处理和发送。

简单讲，无效。

**2. Caller，不等待Callee执行完毕**

无返回调用，服务请求发送后，调用方异步调用结束，不再做任何等待。

对于被调用方的执行时长、执行成功与否，调用方都没有任何感知。

因此，**不要用“无返回调用”执行关键业务**。

**3. 执行失败不可感知**

无返回调用执行失败时，错误只会记录在被调用方的日志中，不会传递回调用方。

**4. Tracing依旧完整**

Tracing，设计的目的，是为了AI做全链故障定位。

所以，“无返回调用”，其Tracing信息，调用链路依然完整。

如果Caller发起调用时，开启了Tracing，那么Callee，执行完毕后，不论成功还是失败，都会以NotifySignal的形式，将Tracing信息回传给调用方，并合并到Caller的Tracing时间线中。

> NotifySignal，是Kree4X传输层，用来实现数据通知的、与服务调用无关的、一个专门信号机制，对于框架使用者来讲，不用深究。

### 四. 涉及到的API

**1. 无返回调用：方法名`_`前缀**

无返回调用，不需要额外API，只有服务调用时的方法名约定。

服务存根上，调用`_`开头的方法，即为无返回调用。

### 五. 可运行代码

完整示例代码，参见：<a href="../examples/01-basic/04-no-response-call.mjs" target="_blank">04-no-response-call.mjs</a>