# Streaming：流式的调用参数，流式的调用结果

> Created By [RV](mailto:rodney.vin@gmail.com), and licensed with Creative Commons "[CC BY-NC-ND 4.0](https://creativecommons.org/licenses/by-nc-nd/4.0/)"

**目的与场景**

在这一章，讲解**两个Kree4X节点**之间的 RPC 调用如何携带流式数据：把文件等流式数据，作为RPC参数、返回结果。

### 一. 概念

**1. 为什么需要流式？**

- 一次序列化数十M、上G的数据，是取死之道
- 真正的流式数据源，在收到结束标记前，可能不知道数据大小。

**2. Streaming 在 Kree4X 中的形态**

- **默认关闭**：kree4n 默认不启用流式传输。创建节点时需要显式开启：

```javascript
Kree4n.create('node-4', 'Streaming RPC', {
  transport: { streaming: { enable: true } }
})
```

- **参数**：调用方传入一个StreamReader，如一个文件流（`NodeFile`），被调方同位置参数会收到一个 `StreamReader`。
- **调用结果**：被调方 `return` 一个StreamReader，如文件流（`NodeFile`），调用方则收到一个 `StreamReader`。
- **缓冲发送**：`streaming.frameSize`（默认 64KB）控制流读取缓冲帧大小，读满，或者流结束，触发一次发送。

### 二. 示例代码

在下边的示例中，我们将：

- nodeA作为TCP服务器，监听端口8096，注册stream服务（接收流参数、返回流结果）
- nodeB作为TCP客户端，连接nodeA
- nodeB把一个**文件**作为**流参数**上传给nodeA
- nodeB请求nodeA返回一个**文件**作为**流结果**，保存到工程 tmp 目录

```javascript
import Kree4n from '@kree4js/kree4n'

// ── Node A（TCP服务器，接收流参数、返回流结果） ─────────────
const nodeA = Kree4n.create('node-a', 'Streaming RPC server', {
  // streaming 默认关闭，必须显式开启
  transport: { streaming: { enable: true } }   
})
nodeA.register('stream', {
  // 接收流参数：流是 AsyncIterable（StreamReader），逐块消费
  upload: async (streamReader) => {
   // 触发式，流式数据已接收完毕
  },
  // 返回文件：NodeFile 基于磁盘文件流式读取，作为流结果返回
  download: () => {
    return new NodeFile(filePath)
  }
})
nodeA.listen('tcp://127.0.0.1:8096')

// ── Node B（调用方） ─────────────
const nodeB = Kree4n.create('node-b', 'Streaming RPC client', {
  transport: { streaming: { enable: true } }
})
nodeB.attach('tcp://127.0.0.1:8096')

await nodeA.start()
await nodeB.start()

const streamSvc = nodeB.service('stream')

// 1. 上传文件：NodeFile 作为流参数上传给 node-a
const uploadFile = new NodeFile(uploadFilePath)
const uploadResult = await streamSvc.upload(uploadFile)

// 2. 下载文件：调用结果是远端文件流，保存到工程 tmp 目录
const fileReader = await streamSvc.download()
// 转存、处理fileReader
```

### 三. 须强调的细节

**1. 必须显式开启流式**

**Why**：流式传输在RPC场景下，不是常见需求。防止你的磁盘，被临时文件占满(上传文件一定要mv临时文件)。

- 流式默认关闭。创建节点时不传 `transport.streaming.enable = true`（或传 false），流参数/流结果会被当作普通值处理而失败。
- 建议调用方与被调方**两侧**都开启。

**2. 如何告知Kree4X参数、返回值是Stream？**

当参数、返回值是`StreamReader`类型时，触发流式处理。

`StreamReader`是Kree4X封装的一个数据类型，用作流式指示标记。

您可以继承`StreamReader`，提供您的私有实现，也可以使用系统內建实现。

StreamReader列表如下：

- `StreamReader`：基类，流式指示标记 / 抽象流。来自 `@kree4js/kree4js` → `Transports.Streaming`
- `GenericStreamReader`：包装内存 / 任意 AsyncIterable。来自 `@kree4js/kree4js` → `Transports.Streaming`
- `FileStreamReader`：NodeJS端，磁盘文件流式读取（抽象基类）。来自 `@kree4js/kree4js` → `Transports.Streaming
- `OPFSStreamReader`：浏览器端，OPFS（Origin Private File System）流读取器。浏览器返回值是流式数据时，返回此类型。
- `NodeFile`：NodeJS端，通过RPC参数传送文件时使用，给定文件路径创建FileStreamReader。来自 `@kree4js/kree4n`
- `BrowserFile`：浏览器端，给定浏览器 Blob/File创建FileStreamReader。来自 `@kree4js/kree4b` 

### 四. 涉及到的API:

**1. 创建节点时开启流式（create options）**

```typescript
/**
 * Kree4n 创建选项。
 *
 * @param {string} name - 节点名。
 * @param {string} [description] - 节点描述。
 * @param {{
 *   transport?: {                 // 传输层配置
 *     streaming?: {               // 流式配置
 *       enable?: boolean,         // 是否启用流式，默认 false
 *       frameSize?: number,       // 流读取缓冲帧大小，默认 64KB
 *       singleMaxSize?: number,   // 单条流最大大小，默认 10MB
 *       memoryMaxSize?: number,   // 所有流累计内存占用上限，默认 1GB
 *       fileMaxSize?: number,     // 所有流累计磁盘占用上限，默认 1GB
 *       backpressure?: {          // 背压控制
 *         enabled?: boolean,      // 是否启用背压，默认 false
 *         highWatermark?: number, // 高水位，默认 0.8
 *         lowWatermark?: number,  // 低水位，默认 0.3
 *         checkIntervalMs?: number // 检查间隔，默认 500
 *       }
 *     }
 *   }
 * }} [options] - 创建选项。
 */
Kree4n.create(name: string, description?: string, options?: CreateOptions)
```

**2. 流读取器（StreamReader）**

`StreamReader` 是流式数据的数据类型 / 流式指示标记，实现 `AsyncIterable`，逐块产出 `Uint8Array`。

```typescript
/**
 * 流读取器抽象基类。
 */
abstract class StreamReader {
  /** 流类型标识，用于占位符创建；子类可覆盖（如 'File'）。 */
  get type(): string

  /** 流元数据，用于占位符序列化；子类覆盖（如 FileStreamReader 返回 name/size/contentType）。 */
  get metadata(): { [key: string]: any }

  /** 流重建后应用占位符中的元数据；子类覆盖以恢复类型特定元数据。 */
  set metadata(metadata: { [key: string]: any })

  // 方法
  /** 销毁流，清理资源；幂等，可重复调用。 */
  destroy(): void

  /** 异步迭代：逐块产出 Uint8Array。抽象，子类必须实现。 */
  [Symbol.asyncIterator](): AsyncIterator<Uint8Array>
}
```

要点：
- **必须实现**（抽象）：`[Symbol.asyncIterator]()`。
- **基类已实现**（具体、幂等）：`destroy()`、`get type`、`get/set metadata`。

```typescript
// import 位置
import Kree4js from '@kree4js/kree4js'
const { StreamReader, GenericStreamReader } = Kree4js.Transports.Streaming
```

**3. 流式调用形态**

```typescript
// 参数：传入 StreamReader
await nodeB.service('stream').upload(new NodeFile('/path/to/file'))

// 调用结果：return StreamReader
const fileReader = await nodeB.service('stream').download('file1.txt')
console.log(fileReader.name, fileReader.size)
```

### 五. 可运行代码

完整示例代码，参见：[14-streaming-data.mjs](../examples/01-basic/14-streaming-data.mjs)