# 扩展通信协议：支持新的通信协议

> Created By [RV](mailto:rodney.vin@gmail.com), and licensed with Creative Commons "[CC BY-NC-ND 4.0](https://creativecommons.org/licenses/by-nc-nd/4.0/)"

**目的与场景**

Kree4X默认实现了TCP、UDP、HTTP、WebSocket、Socket.IO、Kafka等通信协议的扩展包。

在这一章，我们将讲解，如何开发新的`ConnectionProvider`，提供对新通信协议的支持。

### 一. 概念

**1. 通信协议**

通信协议，是指TCP、UDP……之类的跨进程通信协议。

RPC，必然涉及到跨进程数据传输的问题。

TCP、UDP等网络协议是通信协议，操作系统管道也是通信协议，能够支持跨进程数据传输即可。

**2. ConnectionProvider是什么**

使用ConnectionProvider，基于提供者Provider模式，可完成对通信协议的封装，适配KreeX接口API要求。

将ConnectionProvider注入kree4X，即可对特定Protocol的URL进行Listen或者Attach。

`ConnectionProvider`，定义了下述接口方法：

- `understands(netPoint)`：当前Provider是否可以处理指定的netPoint？
- `capability()`：当前Provider支持哪些通信协议？
- `provide(netPoint, transport)`：基于给定的netPoint，创建Connection实例

**3. Listen与Attach**

一个ConnectionProvider，可以同时支持一种通信协议的Listen模式与Attach模式。

实现`understands(netPoint)`方法时，检测`netPoint.mode`，声明自己是否支持该netPoint即可。

声明支持netPoint后，实现`provide(netPoint, transport)`方法，创建相应的Connection实例。

**4. 三种组件组成ConnectionProvider包**

- `ConnectionProvider`：实现该接口，提供注入Kree4X Poviders体系的能力
- `Connection`：实现此接口，提供Connection生命周期支持，即发送数据包DataPack能力。分两侧：
  - `ListenConnection`：服务端，监听新接入
  - `AttachConnection`：客户端，发起连接
- `Channel`：实现此接口，提供Channel生命周期支持，负责数据帧DataFrame的收发。分两侧：
  - `IncomingChannel`：服务端信道
  - `OutgoingChannel`：客户端信道

详情，参阅：

- [连接：Connection](https://zhuanlan.zhihu.com/p/2033481054036677298)
- [信道：Channel](https://zhuanlan.zhihu.com/p/2033522121947755944)

### 二. 示例代码

在下边的示例中，我们将实现一个基于**Unix domain socket（操作系统管道文件）**的进程内直连协议`ipc://<pipeName>`：

- 同时支持**Listen**与**Attach**两种模式
- `node.listen('ipc://<pipeName>')`：在系统临时目录下创建socket文件，等待attach
- `node.attach('ipc://<pipeName>')`：连到该socket文件，建立双向通道
- 两个节点的connection互相收发，支持RPC调用

> 注意：此示例无任何生产级意义，未经完善的覆盖测试、未经平台兼容性测试
>

**1. socket路径生成**

`ipc://<pipeName>`创建的NetPoint，其`netPoint.hostname`对应的`pipeName`（管道名）。

示例中使用pipeName生成socket文件路径，在系统临时目录下创建管道文件：

```javascript
import os from 'node:os'
import path from 'node:path'

// 把管道名映射为 Unix domain socket 的管道文件路径
function buildSockPath (pipeName) {
  return path.join(os.tmpdir(), `kree4x-${pipeName}.sock`)
}
```

**2. 连接提供者：ConnectionProvider**

```javascript
// 连接提供者：继承框架基类，接入Kree4X的Provider体系
class IpcConnectionProvider extends ConnectionProvider {
  // 提供者的名字：用于日志与调试
  name () {
    return 'IpcConnectionProvider'
  }

  // 判断该netPoint（URL + 连接模式）是否由本Provider处理
  understands (netPoint) {
    // protocol取URL的协议段，如ipc://greet的'ipc'
    const protocol = netPoint.protocol.toLowerCase()
    // 只判断protocol，声明同时支持Listen与Attach两种模式
    return protocol === 'ipc'
  }

  // 声明支持的协议名，供框架做能力路由（如协商、转发）
  capability () {
    // attach/listen两侧都支持ipc协议
    return { attach: ['ipc'], listen: ['ipc'] }
  }

  // 为netPoint创建对应的Connection实例
  provide (netPoint, transport) {
    // Listen模式：创建服务端连接（继承ListenConnection）
    if (netPoint.mode === ConnectionMode.Listen) {
      return new IpcListenConnection(transport, netPoint)
    }
    // 其余（Attach模式）：创建客户端连接（继承AttachConnection）
    return new IpcAttachConnection(transport, netPoint)
  }
}
```

**3. 定义服务端连接**

listen侧继承`ListenConnection`，使用`node:net`的`createServer()`创建node:net server。

```javascript
// 引入node:net：使用TCP/Unix domain socket服务端能力
import { createServer } from 'node:net'

// 服务端连接：继承ListenConnection，监听socket文件等待attach
class IpcListenConnection extends ListenConnection {
  // 返回常量类型名：日志/toString中可读（混淆后依然可读）
  getType () {
    return 'IpcListenConnection'
  }

  // 是否单帧mono frame模式：一次data事件是否恰好是一个完整独立的frame。
  // 流式协议，可能粘包/拖包，返回false，由框架负责帧重组
  _isMonoFrameSupported () {
    return false
  }

  // Attach接入时触发的的事件：net server用'connection'事件通知
  _getIncomingConnectEvents () {
    return ['connection']
  }

  // 连接是否存活：此示例简化恒为true
  _isAlive () {
    return true
  }

  // 创建服务端：返回{underlying boundPort?:number, {[key:string]:any}}
  async _createServer () {
    // hostname即URL中'ipc://<pipeName>'的pipeName（管道名）
    const sockPath = buildSockPath(this.netPoint.hostname)
    const server = createServer()
    await new Promise((resolve, reject) => {
      // 失败, 路径非法……
      server.once('error', reject)
      // 成功，socket文件就绪
      server.listen(sockPath, resolve)
    })
    // 把server作为底层返回；框架自动读取并组装
    return { underlying: server }
  }

  // 方法参数是变参...args，来自_getIncomingConnectEvents()的事件被触发时emit的数据
  // 需要返回一个支持EventEmitter的Underlying，net.socket已支持，直接返回
  _createChannelUnderlying (...args) {
    return args[0] // net.socket
  }

  // 把_createChannelUnderlying的返回值包装成IncomingChannel
  _createChannel (channelUnderlying) {
    return new IpcIncomingChannel(this, channelUnderlying)
  }

  // 返回判定"连接断开"的事件名：socket关闭或收到end
  _getBrokenEvents () {
    return ['close', 'end']
  }

  // 关闭时清理：关闭net server，停止监听，释放socket文件
  async _destroyServer (server) {
    await new Promise(resolve => server.close(resolve))
  }
}
```

**4. 定义客户端连接**

attach侧继承`AttachConnection`，用`net.connect()`连接socket文件：

```javascript
// 引入node:net：使用TCP/Unix domain socket客户端连接能力
import { connect as netConnect } from 'node:net'

// 客户端连接：继承AttachConnection，连接socket文件
class IpcAttachConnection extends AttachConnection {
  // 返回常量类型名：日志/toString中可读（混淆后依然可读）
  getType () {
    return 'IpcAttachConnection'
  }

  // 是否单帧（mono frame）模式：与listen侧一致，流式协议返回false
  _isMonoFrameSupported () {
    return false
  }

  // 发起连接：返回底层socket
  async _connect () {
    // hostname即URL中'ipc://<pipeName>'的pipeName
    const sockPath = buildSockPath(this.netPoint.hostname)
    const socket = netConnect(sockPath)
    await new Promise((resolve, reject) => {
      // 连接建立，socket可用
      socket.once('connect', resolve)
      // 连接失败，socket文件不存在等
      socket.once('error', reject)
    })
    // 返回已连接的socket作为底层通道
    return socket
  }

  // 把_createChannelUnderlying的返回值包装成OutgoingChannel（客户端信道）
  _createChannel (channelUnderlying) {
    return new IpcOutgoingChannel(this, channelUnderlying)
  }

  // 返回判定"连接断开"的事件名：socket关闭或收到end
  _getBrokenEvents () {
    return ['close', 'end']
  }
}
```

**5. 定义两侧信道**

attach侧信道继承`OutgoingChannel`，listen侧信道继承`IncomingChannel`，都只实现底层写入：`socket.write()`发送，`socket.destroy()`关闭：

```javascript
// Attach是出站Outgoing信道：继承OutgoingChannel，负责attach侧的帧收发
class IpcOutgoingChannel extends OutgoingChannel {
  // 信道是否存活：socket未被销毁即存活
  _isAlive () {
    return !this.underlying.destroyed
  }

  // 发送一帧：把字节写入socket
  async _send (transportContext, rawData, options) {
    // 统一转成Uint8Array：socket.write需要二进制
    const bytes = new Uint8Array(rawData)
    // 写入socket：数据流向对端
    this.underlying.write(bytes)
  }

  // 关闭信道：销毁socket，触发对端'close'/'end'
  _close () {
    this.underlying.destroy()
  }

  // 返回判定"信道断开"的事件名
  _getBrokenEvents () {
    return ['close', 'end']
  }
}

// Listen是入站Incoming信道：继承IncomingChannel，负责listen侧的帧收发
class IpcIncomingChannel extends IncomingChannel {
  // 信道是否存活：socket未被销毁即存活
  _isAlive () {
    return !this.underlying.destroyed
  }

  // 发送一帧：把字节写入socket（回发给客户端）
  async _send (transportContext, rawData, options) {
    // 统一转成Uint8Array：socket.write需要二进制
    const bytes = new Uint8Array(rawData)
    // 写入socket：数据流向客户端
    this.underlying.write(bytes)
  }

  // 关闭信道：销毁socket，触发对端'close'/'end'
  _close () {
    this.underlying.destroy()
  }

  // 返回判定"信道断开"的事件名
  _getBrokenEvents () {
    return ['close', 'end']
  }
}
```

**6. 注册并使用**

```javascript
// node-a：listen侧节点，注册服务
const nodeA = Kree4N.create('node-a', '服务端节点')
// 注入ipc协议提供者，使节点支持ipc://协议
nodeA.useConnectionProvider(new IpcConnectionProvider())
// 以listen模式监听该URL，创建socket文件
nodeA.listen('ipc://greet')
nodeA.register('greeter', {
  hello (name) {
    return `Hello ${name}`
  }
})
await nodeA.start()

// node-b：attach侧节点，调用服务
const nodeB = Kree4N.create('node-b', '客户端节点')
// 注入同一个ipc协议提供者
nodeB.useConnectionProvider(new IpcConnectionProvider())
// 以attach模式连接该URL，连上socket文件
nodeB.attach('ipc://greet')
await nodeB.start()

// 等待网格传播：让两侧发现彼此的服务
await new Promise(resolve => setTimeout(resolve, 300))

// node-b通过ipc://直连调用node-a的greeter.hello
const result = await nodeB.service('greeter').hello('ipc-direct')
// Hello ipc-direct
```

### 三. 须强调的细节

**1. `understands()` 与 `capability()` 的分工**

- `understands(netPoint)`：当前Provider是否可处理指定的netPoint。
- `capability()`：**声明**动态直连协商机制中，支持的协议名

两者必须一致：

- `understands()`判定`protocol === 'ipc'`
- `capability()`就要声明`{ attach: ['ipc'], listen: ['ipc'] }
- 不一致时，可能导致动态直连协商失败

**2. 协议名与URL解析**

- 协议名**大小写**：是否敏感，依赖Provider实现，示例中不敏感，`understands()`里对`netPoint.protocol`做了`toLowerCase()`
- `ipc://<pipeName>`，协议可以自由定义URL各段的含义。示例Provider中的含义是socket文件名
- `resolveAddress(url)`，若URL的host可能是通配符（eg.`0.0.0.0`），可覆写`resolveAddress(url)`展开真实地址。

**3. `_createServer()` 返回 `{underlying:any, boundPort?:number, {[key:string]:any}}` **

- 要返回上述Shape的对象
- underlying属性，必须存在，示例中是net.socket实例
- boundPort可选，例如TCP Listen不指定端口，系统会随机分配，可获取实际分配参数后，保存在此处

**4. listen侧要实现的钩子**

- `_isMonoFrameSupported()`：是否单帧mono frame模式，一次data事件是否恰好是一个完整frame。返回`false`，则由框架负责帧重组。
- `_getIncomingConnectEvents()`：server上"新接入"的事件名（这里`['connection']`）
- `_createServer()`：创建server并监听，**返回`{ underlying }`**
- `_createChannelUnderlying(...args)`：变参，参数来自`_getIncomingConnectEvents()`的事件被触发时emit的数据。此方法，负责将Attach连入事件中参数，封装为EventEmitterLike的channelUnderlying。框架，监听ChannelUnderlying的事件，获取数据和错误信息。
- `_createChannel(channelUnderlying)`：基于channelUnderlying，创建`IncomingChannel`
- `_destroyServer(server)`：关闭时清理

**5. attach与listen的时序问题**

`net.connect()`连接：attach时，若socket文件不存在，会触发`'error'`事件，`_connect()`抛错。

框架本身有重连/等待机制，连接失败时，等待即可，自会恢复。

**6. 底层通道形态不限**

`_connect()`/`_createServer()`返回的底层对象可以是任意可收发字节的对象

- TCP协议中是`net.Socket`

- 示例中是Unix domain socket的`net.Socket`。

### 四. 涉及到的API:

**1. ConnectionProvider 基类**

```typescript
/**
 * 连接提供者：为连接点（NetPoint）提供连接实例。
 */
class ConnectionProvider {
  /**
   * 提供者的名字。
   * @returns {string}
   */
  name(): string

  /**
   * 判断能否处理该连接点。
   * @param {NetPoint} netPoint - 连接点，含 URL 与连接模式（attach/listen）。
   * @returns {boolean} 能处理返回 true。
   */
  understands(netPoint: NetPoint): boolean

  /**
   * 声明支持的协议名。
   * @returns {{ attach?: string[], listen?: string[] }} 各侧的协议名数组。
   */
  capability(): { attach?: string[], listen?: string[] }

  /**
   * 为连接点创建连接实例。
   * @param {NetPoint} netPoint - 连接点。
   * @param {Transport} transport - 所属传输实例。
   * @returns {Connection} 连接实例。
   */
  provide(netPoint: NetPoint, transport: Transport): Connection

  /**
   * 解析 URL，展开真实地址（如通配符 host 展开为具体地址列表）。
   * 返回 undefined 表示不解析、保留原 URL。
   *
   * - Listen 提供者通过 os.networkInterfaces() 展开通配符（仅 Node）。
   * - Attach 提供者对通配符抛错——通配符不是合法的连接目标。
   * - 默认返回 undefined（哨兵值，表示"不解析，调用方保留原 URL"）
   *
   * @param {string} url - 待解析的 URL。
   * @returns {string[]|undefined} 解析后的 URL 列表，或 undefined 哨兵值表示不解析。
   */
  resolveAddress(url: string): string[] | undefined
}
```

**2. 节点注册连接提供者**

```typescript
/**
 * 注册一个连接提供者，使节点支持新的通信协议。
 * 注册后即可使用 node.attach('<新协议名>://...')。
 *
 * @param {ConnectionProvider} connectionProvider - 连接提供者。
 * @returns {KreeX} 当前节点实例，支持链式调用。
 */
useConnectionProvider(connectionProvider)

/**
 * 注销一个连接提供者。
 *
 * @param {ConnectionProvider} connectionProvider - 连接提供者。
 * @returns {KreeX} 当前节点实例，支持链式调用。
 */
discardConnectionProvider(connectionProvider)
```

**3. AttachConnection，attach必须实现**

```typescript
/**
 * 连接到目标，返回底层通道（Socket / EventEmitter / 其他任意可收发字节的对象）。
 * @returns {Promise<any>|any} 底层通道。
 * @abstract
 */
_connect(): Promise<any>|any

/**
 * 是否单帧（mono frame）模式：一次 data 事件是否恰好是一个完整独立的 frame（不会粘包/拖包）。
 * @returns {boolean}
 * @abstract
 */
_isMonoFrameSupported(): boolean

/**
 * 底层通道包装成 Channel。
 * @param {any} underlying - _connect() 返回的底层通道。
 * @returns {Channel}
 */
_createChannel(underlying: any): Channel
```

**4. ListenConnection，listen 必须实现）**

```typescript
/**
 * 创建服务端并注册接入监听，返回 { underlying } 描述对象。
 * @returns {Promise<{ underlying: any }>|{ underlying: any }}
 * @abstract
 */
_createServer(): Promise<{ underlying: any }>|{ underlying: any }

/**
 * 服务端上"新接入"的事件名。
 * @returns {string[]}
 * @abstract
 */
_getIncomingConnectEvents(): string[]

/**
 * 接入事件参数 → 底层通道。
 * @param {...any} args - 接入事件携带的参数。
 * @returns {any|undefined} 底层通道。
 */
_createChannelUnderlying(...args: any[]): any|undefined
```

### 五. 可运行代码

完整示例代码，参见：<a href="../examples/03-custom/02-custom-protocol.mjs" target="_blank">02-custom-protocol.mjs</a>
