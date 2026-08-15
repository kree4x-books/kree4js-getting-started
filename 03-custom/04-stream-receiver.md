# 流式数据接收：提供StreamReceiver处理流式数据接收

> Created By [RV](mailto:rodney.vin@gmail.com), and licensed with Creative Commons "[CC BY-NC-ND 4.0](https://creativecommons.org/licenses/by-nc-nd/4.0/)"

**目的与场景**

流式调用（见 14-streaming-data）的数据分片到达接收端后，由 `StreamReceiver` 负责接收与读取。本章讲**扩展**：自定义 `StreamReceiverProvider` 接管流式接收，并替换 kree4n 内置的默认接收器。

### 一. 概念

**1. StreamReceiver 是什么**

`StreamReceiver` 是流式数据的**接收端载体**：接收端把分帧到来的流数据逐块交给它（`writeChunk(seq, pdu)`），它缓存/落盘；流完整后调用方通过 `createReader()` 得到一个可异步迭代的 `StreamReader` 消费数据。

```
发送端（StreamReader 迭代） → 分帧传输 → 接收端 writeChunk(seq, pdu) 逐块投递
                                        → isComplete() 判定完整
                                        → createReader() 供服务方法消费
```

**2. 模板方法：实现 `_writeChunk` 而非改写 `writeChunk`**

基类 `writeChunk()` 负责配额校验与销毁保护，然后回调子类钩子。子类**必须**实现：

| 成员 | 职责 | 说明 |
|------|------|------|
| `_quotaType` | 声明配额类型 | `'memory'` 或 `'file'`，走 StreamingQuota 对应上限 |
| `_writeChunk(seq, pdu)` | 接收一个数据块 | 分帧**顺序投递**，可放心追加落盘 |
| `isComplete()` | 判定流是否完整 | 按 `firstSeq..lastSeq` 区间与已收块数比较 |
| `createReader()` | 产出消费方用的读取器 | 返回 `GenericStreamReader`（异步生成器） |
| `destroy()` | 清理资源 | 须先调用 `super.destroy()` |

**3. StreamReceiverProvider 与查找顺序**

- `StreamReceiverProvider.provide(slots, streamIndex)`：为数据包槽创建接收器
- 框架按 **先注册先命中** 顺序调用 `provider.understands(slots)`；全部未命中则回退 `MemoryStreamReceiver`
- **Node.js 环境的默认提供者**：kree4n 在 `create()` 时已注册内置 `FileStreamReceiverProvider`（`understands()` 恒为 true 全接管，流数据落盘临时文件）——所以 Node.js 环境流接收默认就是文件型，而非内存

**4. 替换默认接收器**

内置提供者已"先注册先命中"，直接 `useStreamReceiverProvider()` 注册的新接收器轮不到。替换需要两步：

```javascript
// 1) 移除内置提供者（本节点 transport.ports 上是先注册者）
const [defaultProvider] = nodeA.transport.ports.streamReceiverProviders.providers()
nodeA.transport.ports.discardStreamReceiverProvider(defaultProvider)
// 2) 注册自定义接收器
nodeA.useStreamReceiverProvider(new MyReceiverProvider())
```

### 二. 示例代码

在下边的示例中，我们实现一个**校验型流接收器**：接收时实时校验块序号连续性（重复/乱序/缺失即计数违规），并在流完整时输出统计——演示如何替换 kree4n 默认文件接收器并接管流式接收。

**1. 定义接收器**

```javascript
// 校验型流接收器：继承 StreamReceiver，实现校验与统计
class ValidatingStreamReceiver extends StreamReceiver {
  constructor (streamIndex, packId) {
    super(streamIndex, packId)
    this._seq2Chunk = new Map()
    this._prevSeq = undefined
    this._violations = 0
    this._totalBytes = 0
  }

  // 声明配额类型：'memory'（接收数据缓存在内存中）
  _quotaType = 'memory'

  // 模板方法 writeChunk() 校验配额后回调这里；实现校验与缓存
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

  isComplete () {
    if (this._firstSeq == null || this._lastSeq == null) {
      return false
    }
    const segmentCount = this._lastSeq - this._firstSeq + 1
    const done = this._seq2Chunk.size === segmentCount
    if (done && !this.__reported) {
      this.__reported = true
      logger.info(`[validating-stream] 校验通过: chunks=${this._seq2Chunk.size} totalBytes=${this._totalBytes} violations=${this._violations}`)
    }
    return done
  }

  // 按序号顺序产出已接收的块
  createReader () {
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

**2. 定义提供者**

```javascript
// 提供者：接管流接收器的创建（先移除内置，再注册本提供者）
class ValidatingStreamReceiverProvider extends StreamReceiverProvider {
  name () {
    return 'ValidatingStreamReceiverProvider'
  }

  understands (slots) { // eslint-disable-line no-unused-vars
    return true
  }

  provide (slots, streamIndex) {
    return new ValidatingStreamReceiver(streamIndex, slots.packId)
  }
}
```

**3. 替换默认接收器并验证**

```javascript
const nodeA = Kree4N.create('node-a', '校验接收方', {
  transport: { streaming: { enable: true } }
})
// 1) 移除 kree4n 内置的文件接收器（先注册者先命中，不移除则接管无效）
const [defaultProvider] = nodeA.transport.ports.streamReceiverProviders.providers()
nodeA.transport.ports.discardStreamReceiverProvider(defaultProvider)
// 2) 注册自定义校验型接收器
nodeA.useStreamReceiverProvider(new ValidatingStreamReceiverProvider())
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

运行输出要点（服务器侧接收器日志）：

```
[validating-stream] 校验通过: chunks=5 totalBytes=307200 violations=0
[validating-stream] 流式上传结果: received 307200 bytes
```

### 三. 须强调的细节

**1. Node.js 环境默认就是文件型接收器**

kree4n 的 `create()` 会注册内置 `FileStreamReceiverProvider`，Node.js 环境流式接收默认把数据落盘到临时文件（`MemoryStreamReceiver` 主要用于无文件系统的浏览器环境）。因此"自定义接收器"的关键动作是**替换默认**，而不是祈求没人为你提供。

**2. `provided()` 的遍历顺序**

`streamReceiverProviders.providers()` 返回"本地注册 + 全局端口（Ports）聚合"的全部提供者。`useStreamReceiverProvider()` 注册的实例排在先注册在先；`findProvider()` 取**第一个** `understands()` 为 true 者，所以后注册的接收器不会自动生效。

**3. `_writeChunk` 的投递保证**

分帧按序号**顺序投递**给 `writeChunk()`，接收器可据此直接追加落盘（文件型接收器无需乱序缓冲）。但 `_writeChunk` 应容忍重复块（断点续传/重传场景）：校验型接收器把重复/乱序/缺失记为违规而非崩溃。

**4. `isComplete()` 的区间比较**

完整判定：`期望块数 = lastSeq - firstSeq + 1`，与实际已收块数比较。`firstSeq/lastSeq` 由框架在收到段首/段尾帧时通过 `setFirstSeq()/setLastSeq()` 注入。

**5. 配额类型 `_quotaType`**

- `'memory'`：累计进 StreamingQuota 的 `memoryMaxSize`（默认上限）
- `'file'`：累计进 `fileMaxSize`，适合大文件落盘的接收器
- 超额时框架触发背压（BackpressureGate）或拒绝写入，防止内存爆掉

**6. 框架已预留的类型**

`Transports.Streaming` 已导出 `StreamReceiver`、`StreamReceiverProvider`、`GenericStreamReader`、`MemoryStreamReceiver`、`FileStreamReader` 等，直接从包顶层接入即可。

### 四. 涉及到的API:

**1. StreamReceiverProvider 基类**

```typescript
/**
 * 流接收器提供者：为数据包槽创建流接收器。
 */
class StreamReceiverProvider {
  /**
   * 提供者的名字。
   * @returns {string}
   */
  name(): string

  /**
   * 是否接管该数据包槽的流接收。
   * @param {StreamingDataFrameSlots} slots - 数据包槽。
   * @returns {boolean} 接管返回 true。
   */
  understands(slots: StreamingDataFrameSlots): boolean

  /**
   * 创建流接收器。
   * @param {StreamingDataFrameSlots} slots - 数据包槽（含 packId）。
   * @param {number} streamIndex - 数据包内的流序号。
   * @returns {StreamReceiver} 流接收器实例。
   * @abstract
   */
  provide(slots: StreamingDataFrameSlots, streamIndex: number): StreamReceiver
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
  isComplete(): boolean                 // 必实现：流是否完整
  createReader(): StreamReader          // 必实现：产出读取器
  destroy(): void                       // 必实现：清理（先调 super.destroy()）

  // 框架注入，勿自行赋值：
  _firstSeq | _lastSeq                  // 段首/段尾帧的序号
  writeChunk(seq, pdu)                  // 模板方法：配额校验后回调 _writeChunk
}
```

**3. 节点注册/移除流接收器提供者**

```typescript
/**
 * 注册一个流接收器提供者。
 * 框架在 firstSeq 序内按先注册先命中查找 understands()。
 *
 * @param {StreamReceiverProvider} streamReceiverProvider - 流接收器提供者。
 * @returns {KreeX} 当前节点实例，支持链式调用。
 */
useStreamReceiverProvider(streamReceiverProvider)

/**
 * 按实例移除已注册的流接收器提供者（transport.ports 层级）。
 *
 * @param {StreamReceiverProvider} streamReceiverProvider - 要移除的提供者。
 * @returns {boolean} 移除成功返回 true。
 */
transport.ports.discardStreamReceiverProvider(streamReceiverProvider)
```

### 五. 可运行代码

完整示例代码，参见：<a href="../examples/03-custom/04-stream-receiver.mjs" target="_blank">04-stream-receiver.mjs</a>