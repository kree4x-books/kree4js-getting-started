# 双向注册服务，对等调用

> Created By [RV](mailto:rodney.vin@gmail.com), and licensed with Creative Commons "[CC BY-NC-ND 4.0](https://creativecommons.org/licenses/by-nc-nd/4.0/)"

**目的与场景**

在这一章，讲解两个对等节点如何各自注册服务，并互相调用对方的服务。

### 一. 概念

**对等节点（Peer）**

Kree4X中，所有节点都是对等的，没有严格的Client与Server之分。

listen/attach只是连接建立的方向不同，连接建立后，任意一方都可以注册和调用服务。

**双向注册**

两个节点各自注册自己的服务，两个节点都可以调用对方的服务。

这是微服务架构中常见的模式：服务之间互相依赖，互相调用。

### 二. 双向注册并互相调用

在下边的示例中，我们将：

- 创建两个对等节点
- 两个节点各自注册identifier服务
- A调用B的identifier服务
- B调用A的identifier服务

```javascript
import Kree4n from '@kree4js/kree4n'

// Node A：注册identifier服务，监听端口
const nodeA = Kree4n.create('node-a')
nodeA.register('identifier', {
  whoAreYou () {
    return { name: nodeA.name, id: nodeA.id }
  }
})
nodeA.listen('tcp://127.0.0.1:8000')

// Node B：注册identifier服务，连接Node A
const nodeB = Kree4n.create('node-b')
nodeB.register('identifier', {
  whoAreYou () {
    return { name: nodeB.name, id: nodeB.id }
  }
})
nodeB.attach('tcp://127.0.0.1:8000')

await nodeA.start()
await nodeB.start()

// A调用B的identifier服务
const bInfo = await nodeA.service('identifier').whoAreYou()
// → { name: 'node-b', id: '01KZDV...' }

// B调用A的identifier服务
const aInfo = await nodeB.service('identifier').whoAreYou()
// → { name: 'node-a', id: '01KZDV...' }
```

### 三. 须强调的细节

**对等性**

两个节点角色完全一样：都可以注册服务，都可以调用对方的服务。

listen/attach只是连接建立的方向不同，连接建立后，双方完全对等。

**服务名相同，实现不同**

两个节点注册了同名的identifier服务，但各自的实现不同（返回自己的name和id）。

调用方调用的是对方节点的服务，不是自己的。

### 四. 涉及到的API:

**注册服务 register()**

将一个服务实现注册到Kree4X节点。

```typescript
/**
 * 注册一个服务实现。
 *
 * @param {string} serviceName - 服务名称。
 * @param {object} serviceImpl - 服务实现对象。
 * @returns {Service} 创建的服务实例。
 */
register(serviceName, serviceImpl): Service
```

**获取服务存根 service()**

获取一个服务的透明代理（ServiceCluster），用于发起远程调用。

```typescript
/**
 * 获取或创建一个调用方服务集群。
 *
 * @param {string} name - 服务的限定名称。
 * @returns {ServiceCluster} 服务集群实例。
 */
service(name): ServiceCluster
```

### 五. 可运行代码

完整示例代码，参见：[05-peer-register-invoke.mjs](../examples/01-basic/05-peer-register-invoke.mjs)


