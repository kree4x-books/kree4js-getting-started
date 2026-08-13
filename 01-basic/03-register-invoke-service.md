# 注册并调用服务

> Created By [RV](mailto:rodney.vin@gmail.com), and licensed with Creative Commons "[CC BY-NC-ND 4.0](https://creativecommons.org/licenses/by-nc-nd/4.0/)"

**目的与场景**

在这一章，讲解如何在Kree4X节点上注册服务，并通过另一个节点调用该服务。

### 一. 概念

**1. 被调用者：Callee**

Callee，被调用者，是一个动态的概念。

我们的体系中，不存在Server节点、Client节点的概念。

静态结构中，所有的节点都是平等的。一个开放了Http服务器的服务节点，并不比一个坐落于浏览器中服务节点更特殊。

如果一个服务节点开放了服务，在服务被调用的过程中，这个服务节点是"被调用者"，它就是Callee。

**2. 调用者：Caller**

Caller与Callee是相对的，同样是一个动态的概念。

如果一个服务节点发起了一次服务调用，那么这个服务节点就是"调用者"，它就是Caller。

**3. 服务：Service**

服务可以是一个函数、一个普通对象、一个类实例、或者就是类构造子本身。

将一个服务注入服务节点，则可以被远程其他节点调用。

**4. 服务注册： Service Register**

调用一个服务节点的register(name, impl)方法，可以将一个服务注册到服务节点中。

服务，和通信协议没有任何关系。

一个服务注册后，可以通过任何一种节点支持的通信协议被透明调用。

**5. 服务存根: Service Stub**

服务存根，实际是一个基于ServiceCluster实例的ES6 Proxy。

使用kree4x.service(name):ServiceCluster，可以获取一个服务的透明代理。

这个透明代理，我们称之为服务存根。

透过服务存根，可以发起服务调用，设定服务发现、选择、结果合并的策略，设置服务调用的超时时间、重试策略等。

**6. 服务调用：Service Call**

远程服务开放的任何方法，通过服务存根，都可以透明调用。

对远程服务的一次方法调用，我们称之为服务调用，ServiceCall。

### 二. 注册并调用服务

在下边的示例中，我们将：

- 创建两个服务节点，并通过tcp互相连接
- 一个节点，注册开放一个简单的“计算器”服务
- 另外一个节点，创建服务存根
- 通过服务存根，发起服务调用，获取调用结果

```javascript
import Kree4n from '@kree4js/kree4n'

// callee：监听端口，注册服务
const callee = Kree4n.create('node-a')
callee.listen('tcp://127.0.0.1:8090')

// caller：Attach到callee端口
const caller = Kree4n.create('node-b')
caller.attach('tcp://127.0.0.1:8090')

await callee.start()
await caller.start()

// 计算器，普通对象，封装一个add方法
const calculator = {
  add (a, b) {
    return a + b
  }
}
// 服务注册
callee.register('calc', calculator)

// 创建服务存根
const calc = caller.service('calc')
// 发起服务调用，获得调用结果；ES6 Proxy，调用会被透明转发到远程
const result = await calc.add(10, 20)
// result: 30
```

### 三. 须强调的细节

**1. 三种注册方式**

```javascript
// 1. 普通对象式服务
callee.register('calc', calculator)

// 2. 类实例式服务（复用一个实例）
callee.register('greeter', new Greeter())

// 3. 类构造子注册为服务（每次调用新建实例）
callee.registerClass('space.greeter', Greeter)
```

**2. 服务命名**

服务名可自由定义（如 `calc`、`greeter`、`space.greeter`），无格式要求。

**3. 同步与异步**

服务调用，一定是async，异步的。

**4. 远程调用不能假装语义透明**

Waldo在《A Note on Distributed Computing》中早已指出：远程调用不能假装语义透明。

Waldo之剑悬在头顶，任何试图抹杀远程和本地调用差别的人，都会被斩落马下。

我们一直所讲“透明调用”，透明的是调用方式，而不是调用语义：

- 调用一定是异步的
- 服务存根有默认的超时控制
- 服务存根有默认的错误处理，重试策略
- 服务存根有默认的服务发现策略
- 服务存根有默认的服务选择策略
- 服务存根有默认的服务结果合并策略

这些概念及如何使用，我们在中级进阶篇再详谈。

### 四. 涉及到的API

**1. 注册服务register()**

将一个服务实现注册到Kree4X节点。

```typescript
/**
 * 注册一个服务实现。
 *
 * @param {string} serviceName - 服务名称。
 * @param {object|(new (...args:any[])=>Service)} serviceImpl - 服务实现对象或类。
 * @param {{[key:string]:any}} [serviceOption] - 服务配置选项。
 * @returns {Service} 创建的服务实例。
 */
register(serviceName, serviceImpl, serviceOption?): Service
```

**2. 注册类服务registerClass()**

将一个类构造函数注册为服务，每次调用新建实例。

```typescript
/**
 * 注册一个基于类的服务实现。
 *
 * @param {string} serviceName - 服务名称。
 * @param {(new (...args:any[])=>Service)} serviceImpl - 服务类构造函数。
 * @param {{[key:string]:any}} [serviceOption] - 服务配置选项。
 * @returns {Service} 创建的服务实例。
 */
registerClass(serviceName, serviceImpl, serviceOption?): Service
```

**3. 获取服务存根service()**

获取一个服务的透明代理（ServiceCluster），用于发起远程调用。

```typescript
/**
 * 获取或创建一个调用方服务集群。
 *
 * @param {string} name - 服务的限定名称。
 * @param {ServiceClusterOptions} [options] - 服务集群选项。
 * @param {boolean} [forceNew=false] - 是否强制创建新的ServiceCluster。
 * @returns {ServiceCluster} 服务集群实例。
 */
service(name, options?, forceNew?): ServiceCluster
```

### 五. 可运行代码

完整示例代码，参见：[03-register-invoke-service.mjs](../examples/01-basic/03-register-invoke-service.mjs)
