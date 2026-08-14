# 传输策略：使用TransportPolicy为服务调用适配通信协议与信道

> Created By [RV](mailto:rodney.vin@gmail.com), and licensed with Creative Commons "[CC BY-NC-ND 4.0](https://creativecommons.org/licenses/by-nc-nd/4.0/)"

**目的与场景**

在生产环境中，一个节点可能通过多种协议与对端建立多条连接与信道，例如：

- 事件订阅场景：优先走Kafka，保证至少一次投递
- 实时通信场景：优先走WebSocket，降低延迟
- 跨网段场景：TCP控制面 + UDP数据面，按用途选择信道

默认情况下，服务调用自动选择**任意可用信道**，不做筛选。

在这一章，讲解如何使用 **TransportPolicy（传输策略）** 为服务调用**适配通信协议与信道**：显式指定调用只走哪一类协议、哪一条信道。

### 一. 概念

**1. 为什么需要传输策略**

节点之间可能同时存在多条信道，例如：

- 同一种协议可有多条连接，例如，连接池……
- 不同协议可并存，例如：TCP + UDP + HTTP……

默认的"**任意可用信道**"策略，在多数场景是够用的。

但是，某些场景，可能需要**精细化控制**，例如：

- 指定协议：业务类调用走TCP，通知类调用走UDP
- 指定连接：某类业务，只允许走某条特定链路
- 业务隔离：高优先级会员，流量走专用信道

`TransportPolicy` 就是为这种"信道选择"提供的一个**可插拔的通用机制**。

为一个服务存根，设置传输策略，则后续的服务调用，按传输策略自动筛选信道。

**2. 策略的职责：两级筛选**

`TransportPolicy` 抽象基类定义了两个筛选方法：

- `selectConnection(connections)`：为服务调用筛选可用连接
- `selectChannel(channels)`：为服务调用筛选可用信道

关于连接Connection与信道Channel，简单将：

打开一个NetPoint，得到一个Connection；一个Connection内部会有0...N个Channel。

详情，参阅：

- [网点：Net Point](https://zhuanlan.zhihu.com/p/2033268200566170768)
- [连接：Connection](https://zhuanlan.zhihu.com/p/2033481054036677298)
- [信道：Channel](https://zhuanlan.zhihu.com/p/2033522121947755944)

**3. 内置策略**

`Transports.TransportPolicies` 提供两个内置策略：

```javascript
const { AllPolicy, PreferredProtocolPolicy } = Transports.TransportPolicies

new AllPolicy()                          // 全部信道都放行（等价默认行为）
new PreferredProtocolPolicy('tcp')       // 指定偏好的协议
```

`PreferredProtocolPolicy(protocol)` 按 `connection.netPoint.protocol === protocol` **精确匹配**，例如 `'tcp'`、`'udp'`。

若筛选结果为空，无匹配信道，服务调用抛错、失败。

**4. 自定义策略**

策略机制是开放扩展的：继承 `TransportPolicy`，覆写两个筛选方法即可。

**5. 如何设置策略**

`serviceStub.transportPolicy(policy)` ，在使用服务存根**发起首次调用前**设置：

```javascript
const greet = nodeB.service('greet')
greet.transportPolicy(new PreferredProtocolPolicy('tcp'))
```

策略设置后，该服务集群的每一次调用都按策略筛选信道。

### 二. 示例代码

在下边的示例中，我们搭建一个**服务注册方 + 调用方**的拓扑：

- node-a：注册多个服务（每个服务对应一个策略场景，互不干扰），同时 TCP、UDP 监听
- node-b：调用方，TCP、UDP 双挂接，对每个服务设置不同策略，观察信道筛选行为

node-a 与 node-b 之间存在 TCP、UDP 两条直连信道，传输策略才有得选。

**1. 搭建拓扑**

```javascript
const greeting = { hello (n) { return 'Hello ' + n } }
const nodeA = create('node-a', 'TCP+UDP provider')
for (const name of ['greet', 'greet-all', 'greet-tcp', 'greet-udp', 'greet-nx', 'greet-custom']) {
  nodeA.register(name, greeting)
}
nodeA.listen('tcp://127.0.0.1:8065', { frameLimit: 1152 })
nodeA.listen('udp://127.0.0.1:8066', { frameLimit: 1152, ack: true })

const nodeB = create('node-b', 'Policy caller')
nodeB.attach('tcp://127.0.0.1:8065', { frameLimit: 1152 })
nodeB.attach('udp://127.0.0.1:8066', { frameLimit: 1152, ack: true })

await nodeA.start()
await nodeB.start()

// TCP挂接需要negotiate握手，UDP即时连通；等片刻让两条信道都建立
await PromiseUtils.delay(100)
```

**2. 默认（无策略）：自动选信道**

不设置 `transportPolicy`，等价于"任意信道可用"：

```javascript
const resultDefault = await nodeB.service('greet').hello('default')
// Hello default
```

**3. AllPolicy：显式全放行**

`AllPolicy` 是默认策略，任一连接、信道均可：

```javascript
const greetAll = nodeB.service('greet-all')
greetAll.transportPolicy(new AllPolicy())
const resultAll = await greetAll.hello('all')
// Hello all
```

**4. PreferredProtocolPolicy('tcp')：走TCP信道**

TCP直连信道存在，`'tcp'` 精确匹配成功：

```javascript
const greetTcp = nodeB.service('greet-tcp')
greetTcp.transportPolicy(new PreferredProtocolPolicy('tcp'))
const resultTcp = await greetTcp.hello('tcp')
// Hello tcp
```

**5. PreferredProtocolPolicy('udp')：走UDP信道**

UDP直连信道存在，`'udp'` 精确匹配成功：

```javascript
const greetUdp = nodeB.service('greet-udp')
greetUdp.transportPolicy(new PreferredProtocolPolicy('udp'))
const resultUdp = await greetUdp.hello('udp')
// Hello udp
```

**6. PreferredProtocolPolicy('nonexistent')：无匹配信道，调用失败**

协议名不匹配任何信道时，调用抛错，错误信息可读：

```javascript
const greetNx = nodeB.service('greet-nx')
greetNx.transportPolicy(new PreferredProtocolPolicy('nonexistent'))
await greetNx.hello('nonexistent')
// 抛错：TransportPolicy "PreferredProtocolPolicy" selected no channels for dstId "01KZX..."
```

**7. 自定义策略**

继承 `TransportPolicy`，定义自己的筛选逻辑：

```javascript
const { TransportPolicy } = Transports

// 全量放行的自定义策略（等价AllPolicy，演示扩展点）
class PassThroughPolicy extends TransportPolicy {
  selectConnection (connections) { return connections }
  selectChannel (channels) { return channels }
}

const greetCustom = nodeB.service('greet-custom')
greetCustom.transportPolicy(new PassThroughPolicy())
const resultCustom = await greetCustom.hello('custom')
// Hello custom
```

### 三. 须强调的细节

**1. 策略必须在首次调用前设置**

`ServiceCluster` 会缓存已发现的服务代理（ProxyService）。

**首次调用时发现的服务代理携带当时的策略**；之后修改策略，缓存代理继续沿用旧策略，修改不生效。

**2. 策略基于服务存根设置**

传输策略，是基于创建的服务存根，来设置、生效的。

这意味着，你可以针对同一个远程服务，获得多个存根，分别设置传输策略。

这样，不同的服务存根发起的调用，就会通过不同的通信协议、信道传输。

**注意:**  `kree4X.service(name:string, forceNew=false)`

多次获取同名服务的存根，不指定forceNew，实际返回的是同一个实例。

**3. 精确匹配协议名**

`PreferredProtocolPolicy` 按 `netPoint.protocol === protocol` 精确比较。

协议名是**小写**（如 `'tcp'`、`'udp'`），需与连接实际协议一致。

### 四. 涉及到的API

**1. 设置传输策略**

```typescript
/**
 * 设置服务集群的传输策略，用于筛选调用信道。
 *
 * - 策略必须在首次调用前设置；缓存的服务代理沿用首次发现时的策略。
 * - 点对点调用按selectChannel()筛选信道；
 *   广播按selectConnection()筛选连接。
 *
 * @param {TransportPolicy} policy - 传输策略实例。
 * @returns {this} 当前存根，支持链式。
 */
transportPolicy(policy): this
```

**2. TransportPolicy基类**

```typescript
/**
 * 传输策略抽象基类。子类必须实现两个筛选方法。
 */
class TransportPolicy {
  /**
   * 广播路径：从可用连接中按策略筛选。
   * @param {Connection[]} connections - 可用连接集合。
   * @returns {Connection[]} 筛选后的连接；无匹配时为空数组。
   */
  selectConnection(connections): Connection[]

  /**
   * 点对点路径：从可用信道中按策略筛选。
   * @param {Channel[]} channels - 可用信道集合。
   * @returns {Channel[]} 筛选后的信道；无匹配时为空数组。
   */
  selectChannel(channels): Channel[]

  /**
   * 默认返回类名（如 "PreferredProtocolPolicy"），用于错误信息。
   * 建议子类保持默认实现。
   */
  toString(): string
}
```

**3. 内置策略（Transports.TransportPolicies）**

```typescript
AllPolicy                    // 全放行：筛选结果=原集合（等价默认行为）
PreferredProtocolPolicy(protocol:string)  // 只保留netPoint.protocol精确匹配的信道
```

### 五. 可运行代码

完整示例代码，参见：<a href="../examples/02-advance/11-transport-policy.mjs" target="_blank">11-transport-policy.mjs</a>