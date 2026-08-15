# 流式数据接收：提供StreamReceiver处理流式数据接收

> Created By [RV](mailto:rodney.vin@gmail.com), and licensed with Creative Commons "[CC BY-NC-ND 4.0](https://creativecommons.org/licenses/by-nc-nd/4.0/)"

**目的与场景**

Kree4X支持Streaming模式，允许RPC调用参数及返回结果是Streaming类型（例如文件），详见基础篇《Streaming：流式的调用参数，流式的调用结果》。

基础篇中，我们有意地跳过了一个细节：流式传送的终点，目标节点如何接收流式的数据？

接收流式参数，然后保存在内存中？这违背了流式传送“**仅消耗有限、定量内存**”的设计本意。

Kree4N中，默认使用临时文件接收流式数据。在接收完毕后，基于临时文件创建StreamReader，并返回给开发者。

在这一章，我们将讲解如何实现`StreamReceiver`接口，通过设置`StreamReceiverFactory`，扩展Kree4X接收处理流式数据的能力。

### 一. 概念

**1. 流接收器：StreamReceiver**

`StreamReceiver` 是流式数据的**接收者**。

Kree4X节点，将分帧到来的流数据，逐块交给StreamReceiver，由StreamReceiver缓存或保存数据块。

完整接收完毕，StreamReceiver.createReader()可创建并返回读取器，用来读取接收的完整数据。

**2. 流接收器工厂：StreamReceiverFactory**

`StreamReceiverFactory`，定义了下述接口方法：

- `create(streamIndex:number, packId:string)`：基于数据包内的流序号与DataPack标识，创建StreamReceiver实例
- streamIndex，第几个流，从零计数。一次RPC调用，可能有多个流类型参数
- packId，数据包DataPack的id

一个KreeX节点，可持有**一个** `StreamReceiverFactory`。

未设置`StreamReceiverFactory`时:

- Kree4N NodeJS节点，默认使用内置的 `FileStreamReceiverFactory`
- Kree4B浏览器节点，在HTTPS或localhost下默认使用内置的 `OPFSStreamReceiverFactory`，否则默认使用 `MemoryStreamReceiver`

**3. 设置流接收器工厂**

`Kree4X.setStreamReceiverFactory()` 即**替换**默认流接收器工厂。

```javascript
// 一个节点一个工厂，设置即替换
nodeA.setStreamReceiverFactory(new MyReceiverFactory())
```

**4. 块的序号：seq**

`StreamReceiver._writeChunk(seq, pdu)` 逐块写入接收数据，系统**不保证**数据块按seq顺序到达。

Receiver应根据seq动态计算写入位置，支持随机写入。

- `seq`：**块在流内的序号**，从0起递增。同一流内，块按`seq`排序即为完整流数据
- `pdu`：块数据
- 序号乱序或缺失，可通过`seq`检测

**5. 数据块的大小：chunkLimit**

`StreamReceiver._writeChunk(seq, pdu)`时，除了最后一个数据块pdu，其它块都是等长的。

通过`StreamReceiver.chunkLimit`，可以获知这个固定的块大小，字节数。

通过比较pdu.byteLength与chunkLimit，即可知当前chunk是否是流的尾块，结合seq，可支持当前块在整个流中的随机位置计算。

### 二. 示例代码

在下边的示例中，我们实现一个**校验型流接收器**：接收时实时校验块序号连续性（重复/乱序/缺失即计数违规），并在流完整时输出统计——演示如何替换 kree4n 默认文件接收器并接管流式接收。

**1. 定义接收器**

```javascript
// 校验型流接收器：继承 StreamReceiver，实现校验与统计
class ValidatingStreamReceiver extends StreamReceiver {
  constructor (streamIndex, packId) {
    super(streamIndex, packId)
    // 声明配额类型：'memory'（接收数据缓存在内存中）
    this._quotaType = 'memory'
    this._seq2Chunk = new Map()
    this._prevSeq = undefined
    this._violations = 0
    this._totalBytes = 0
  }

  // 模板方法 writeChunk() 校验配额后回调这里；seq是块在流内的序号
  _writeChunk (seq, pdu) {
    if (this._prevSeq != null && seq <= this._prevSeq) {
      // 重复或乱序块
      this._violations++
      return
    }
    if (this._prevSeq != null && seq > this._prevSeq + 1) {
      // 序号跳跃：存在缺失块
      this._violations++
    }
    this._seq2Chunk.set(seq, pdu)
    this._totalBytes += pdu.byteLength
    this._prevSeq = seq
  }

  // 已收块计数：框架据此判定流是否完整
  _getReceivedCount () {
    return this._seq2Chunk.size
  }

  // 按序号顺序产出已接收的块
  createReader () {
    if (!this.__reported) {
      this.__reported = true
      logger.info(`[validating-stream] 校验通过: chunks=${this._seq2Chunk.size} totalBytes=${this._totalBytes} violations=${this._violations}`)
    }
    const firstSeq = this._firstSeq ?? 0
    const lastSeq = this._lastSeq ?? -1
    const seq2Chunk = this._seq2Chunk
    const asyncGen = (async function * () {
      for (let i = firstSeq; i <= lastSeq; i++) {
        const chunk = seq2Chunk.get(i)
        if (chunk != null && chunk.byteLength > 0) {
          yield chunk
        }
      }
    })()
    return new GenericStreamReader(asyncGen)
  }

  destroy () {
    if (this._destroyed) {
      return
    }
    super.destroy()
    this._seq2Chunk.clear()
  }
}
```

**2. 定义工厂**

```javascript
// 工厂：节点级单一工厂，create() 创建校验型接收器
class ValidatingStreamReceiverFactory extends StreamReceiverFactory {
  create (streamIndex, packId) {
    return new ValidatingStreamReceiver(streamIndex, packId)
  }
}
```

**3. 替换默认接收器并验证**

```javascript
// streaming 选项同时用于配额设置：singleMaxSize 单个接收器上限，memoryMaxSize 内存配额
const nodeA = Kree4N.create('node-a', '校验接收方', {
  transport: {
    streaming: {
      enable: true,
      singleMaxSize: 10 * 1024 * 1024,
      memoryMaxSize: 256 * 1024 * 1024
    }
  }
})
// 节点级单一工厂：直接设置即替换 kree4n 内置的 FileStreamReceiverFactory
nodeA.setStreamReceiverFactory(new ValidatingStreamReceiverFactory())
nodeA.register('stream', {
  upload: async (streamReader) => {
    let total = 0
    for await (const chunk of streamReader) {
      total += chunk.byteLength
    }
    return `received ${total} bytes`
  }
})
nodeA.listen(`tcp://127.0.0.1:${PORT}`)
await nodeA.start()

// node-b 上传 300KB 文件（>64KB 帧缓冲，多帧分片）
const nodeB = Kree4N.create('node-b', '文件发送方', {
  transport: { streaming: { enable: true } }
})
nodeB.attach(`tcp://127.0.0.1:${PORT}`)
await nodeB.start()

const result = await nodeB.service('stream').upload(new Kree4N.NodeFile(filePath))
// received 307200 bytes
```

### 三. 须强调的细节

**1. Node.js 环境默认就是文件型接收器**

Kree4N默认设置为 `FileStreamReceiverFactory`。

所以，Node.js 环境，默认将数据缓存到临时文件。

Kree4B，HTTPS或localhost时，默认设置为 `OPFSStreamReceiverFactory`，否则设置内置 `MemoryStreamReceiver`。

所以，浏览器环境，优先尝试将数据写入OPFS（Origin Private File System），回退时，使用内存缓存。

**2. 一节点一工厂**

一个节点只持有**一个** `StreamReceiverFactory`。

`setStreamReceiverFactory()` 设置时，直接**替换**旧有工厂，设置即生效。

**3. 配额类型 `_quotaType`**

Kree4X，框架层内置流式数据消耗资源的配额管理及背压控制。

Receiver，须声明自己消耗的资源类型：

- `'memory'`：累计进 `memoryMaxSize`
- `'file'`：累计进 `fileMaxSize`
- 超出配额时，框架自动触发背压，进行流控

默认配额（`StreamingQuota`）：

- `singleMaxSize` 单个流配额，10MB
- `memoryMaxSize` 总内存配额，1GB
- `fileMaxSize` 总磁盘配额，1GB

可通过kree4X `options.transport.streaming` 调整：

```javascript
Kree4N.create('node-a', '校验接收方', {
  transport: {
    streaming: {
      enable: true,
      singleMaxSize: 10 * 1024 * 1024,   // 单个流上限
      memoryMaxSize: 256 * 1024 * 1024,  // 内存配额
      fileMaxSize: 1 * 1024 * 1024 * 1024 // 文件配额
    }
  }
})
```

**5. 框架已内建的类型**

`Transports.Streaming` 已导出：

- `StreamReceiver`，接收器接口
- `StreamReceiverFactory`，工厂类
- `GenericStreamReader`，抽象基类
- `MemoryStreamReceiver`，内存实现
- `FileStreamReader`，文件实现

### 四. 涉及到的API:

**1. StreamReceiverFactory 基类**

```typescript
/**
 * 流接收器工厂：为数据包内的流创建流接收器。
 */
class StreamReceiverFactory {
  /**
   * 创建流接收器。
   * @param {number} streamIndex - 数据包内的流序号（从0开始）。
   * @param {string} packId - DataPack标识。
   * @returns {StreamReceiver} 流接收器实例。
   * @abstract
   */
  create(streamIndex: number, packId: string): StreamReceiver
}
```

**2. StreamReceiver 抽象基类**

```typescript
/**
 * 流接收器：接收分帧流数据，向消费方提供读取器。
 */
class StreamReceiver {
  _quotaType: 'memory'|'file'          // 必声明：配额类型
  _writeChunk(seq: number, pdu: Uint8Array): void  // 必实现：收一个数据块（模板回调）
  _getReceivedCount(): number           // 必实现：已收块计数（框架据此判定完整）
  createReader(): StreamReader          // 必实现：产出读取器
  destroy(): void                       // 必实现：清理（先调 super.destroy()）

  // 框架提供，无需子类实现：
  writeChunk(seq, pdu)                  // 模板方法：配额校验后回调 _writeChunk
  setFirstSeq(seq) | setLastSeq(seq)    // 段首/段尾帧到达时由框架注入

  // 框架注入，勿自行赋值：
  _firstSeq | _lastSeq                  // 段首/段尾帧的序号
}
```

**3. 节点设置流接收器工厂**

```typescript
/**
 * 设置流接收器工厂（节点级单一工厂，重复设置替换旧工厂）。
 *
 * @param {StreamReceiverFactory} streamReceiverFactory - 流接收器工厂。
 * @returns {KreeX} 当前节点实例，支持链式调用。
 */
setStreamReceiverFactory(streamReceiverFactory)

/**
 * 读取当前流接收器工厂。
 *
 * @returns {StreamReceiverFactory|undefined} 当前流接收器工厂。
 */
get streamReceiverFactory(): StreamReceiverFactory|undefined
```

### 五. 可运行代码

完整示例代码，参见：<a href="../examples/03-custom/04-stream-receiver.mjs" target="_blank">04-stream-receiver.mjs</a>