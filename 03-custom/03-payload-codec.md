# 扩展载荷编解码：自定义PayloadCodec与TransferProtocol

> Created By [RV](mailto:rodney.vin@gmail.com), and licensed with Creative Commons "[CC BY-NC-ND 4.0](https://creativecommons.org/licenses/by-nc-nd/4.0/)"

**目的与场景**

Kree4X的传输栈分为三层：`ConnectionProvider`（连接层，上一章所讲）、`TransferProtocol`（帧格式层）、`PayloadCodec`（载荷编码层）。

在这一章，我们将讲解：

- 如何开发自定义`PayloadCodec`，控制服务调用载荷的字节表示
- 如何扩展`TransferProtocol`（继承内置二进制协议，更换协议码，注入自定义编解码器）
- 通过`useProtocol()`注册协议，两端协商后即可互通

### 一. 概念

**1. 传输栈三层模型**

Kree4X把"跨进程字节传输"拆成三层，各司其职：

- `ConnectionProvider`：**连接层**。TCP、UDP、WebSocket、Kafka……负责建立连接通道，收发原始字节。
- `TransferProtocol`：**帧格式层**。负责分帧（帧头/帧尾）、流定界、原始字节的能力识别（trait）。
- `PayloadCodec`：**载荷编码层**。负责结构化数据（对象/数组/字符串……）与载荷字节的双向转换。

**2. TransferProtocol是什么**

`TransferProtocol`，定义了传输协议的抽象接口：

- `code`（4字符）与`name`：协议标识。注册表按`code`键索引，**两端必须一致**才能协商成功。
- `encode(thing, payloadCodecOrCode, options)` / `decode(dataPack)`：载荷与数据包的双向转换（委托给`ProtocolCodec`）。
- 分帧能力：`headerLength()`/`trailerLength()`、`computeFramePduLimit()`/`computeFrameLength()`。
- 识别能力：`_createTraitIdentifier()`——从原始字节识别本方协议的帧。

内置的`BinaryProtocol`（协议码`KBTP`）是Kree4X默认实现的完整二进制传输协议。

**3. PayloadCodec是什么**

`PayloadCodec`，定义了载荷编码器的抽象接口，只需实现4个内部方法：

- `_code()`：4字符编解码器码（如内置`JSON`、`MSGPACK`）
- `_name()`：可读名称
- `_encode(payload, options)`：对象 → 帧字节，返回`PayloadEncodeResult`
- `_decode(pdu)`：载荷字节 → 对象

**4. useProtocol()注册协议**

`KreeX.useProtocol(transferProtocol)`：注册`TransferProtocol`并**设为节点默认协议**（默认`asDefault=true`）。

协议注册进`TransferProtocols`注册表（以`code`为键），节点后续的载荷收发，默认走该协议的默认编解码器。

**5. 默认编解码器必须是"通用自描述格式"**

**这是自定义`PayloadCodec`时最重要的约束。**

服务调用的载荷，只是KreeX流量的一部分；网格服务发现（WhoHasSignal）、Beacon、Tracing等**内部信号同样经过默认编解码器**传输出网。

因此，把自定义编解码器设为默认时，它必须能编码**任意JSON结构**（对象/数组/字符串/数字/布尔/null的任意嵌套）。否则内部信号会在对端解码失败——例如：

- 自定义编解码器只能处理数字数组
- 对端收到WhoHasSignal（载荷是`{ service: 'calc' }`对象）时，`service`字段丢失
- 接收端实例化信号时抛出`Missing "service"`

内置`JSON`/`MSGPACK`编解码器都是通用格式的原因，正在于此。

### 二. 示例代码

在下边的示例中，我们将：

1. 实现一个自定义`PayloadCodec`：`MiniJsonCodec`（码`MJSN`），用"类型标记+递归"的迷你自描述格式（类似简化版MessagePack），实现任意JSON结构的紧凑二进制序列化
2. 实现一个自定义`TransferProtocol`：`MiniJsonProtocol`（码`MJSP`），**继承内置BinaryProtocol**，复用其全部分帧/识别/组装实现，只更换协议码，并把`MiniJsonCodec`注入为默认编解码器
3. 两端`useProtocol()`注册同一套协议，服务调用与网格信号的载荷均用`MJSN`双向编解码

> 注意：此示例无任何生产级意义，未经完善的覆盖测试、未经平台兼容性测试

**1. 自定义PayloadCodec：MiniJsonCodec**

类型标记编码表：

| 字节 | 含义 |
|------|------|
| `0x00` | null（undefined同） |
| `0x02` | bool（1字节0/1） |
| `0x03` | number（8字节float64大端） |
| `0x04` | string（4字节长度 + utf8字节） |
| `0x05` | array（元素序列 + `0xFF`结束） |
| `0x06` | object（key/value序列 + `0xFF`结束） |

```javascript
// 自定义载荷编解码器：继承框架基类，实现4个内部方法
class MiniJsonCodec extends PayloadCodec {
  // 可读名称
  _name () {
    return 'Mini JSON Codec'
  }

  // 4字符编解码器码（与内置'JSON'/'MSGPACK'同族）
  _code () {
    return 'MJSN'
  }

  // 对象 → 帧字节：编码 + 按帧PDU上限校检 + 预留帧头/帧尾空间
  _encode (payload, options) {
    const {
      frameLimit = Infinity,
      framePduLimit = Infinity,
      headerLength = 0,
      trailerLength = 0
    } = options
    // encodeAny()递归序列化整个载荷
    const body = encodeAny(payload)
    if (body.length > framePduLimit) {
      throw new Error(`MiniJsonCodec: payload too large (multi-frame not implemented)`)
    }
    // 帧字节 = 帧头预留 + 载荷 + 帧尾预留
    const frameLength = headerLength + body.length + trailerLength
    const buffer = new Uint8Array(frameLength)
    buffer.set(body, headerLength)
    return {
      frameResult: {
        buffer,
        frames: [[0, frameLength]], // [起始偏移, 帧长度]列表
        headerLength,
        trailerLength
      },
      frameLimit,
      framePduLimit
    }
  }

  // 载荷字节 → 对象：按类型标记递归还原
  _decode (pdu) {
    const state = { offset: 0 }
    const value = decodeAny(pdu, state)
    if (state.offset !== pdu.length) {
      throw new Error(`MiniJsonCodec: trailing bytes after decode`)
    }
    return value
  }
}
```

递归编码与解码（类定义之后的独立函数）：

```javascript
// 编码任意值（递归）：null/bool/number/string/array/object
function encodeAny (value) {
  if (value == null) return Uint8Array.of(0x00)
  if (typeof value === 'boolean') return Uint8Array.of(0x02, value ? 1 : 0)
  if (typeof value === 'number') {
    const bytes = new Uint8Array(9)
    bytes[0] = 0x03
    new DataView(bytes.buffer).setFloat64(1, value)
    return bytes
  }
  if (typeof value === 'string') {
    const raw = new TextEncoder().encode(value)
    const bytes = new Uint8Array(5 + raw.length)
    bytes[0] = 0x04
    new DataView(bytes.buffer).setUint32(1, raw.length)
    bytes.set(raw, 5)
    return bytes
  }
  if (Array.isArray(value)) {
    const chunks = [Uint8Array.of(0x05)]
    for (const item of value) chunks.push(encodeAny(item))
    chunks.push(Uint8Array.of(0xFF)) // 数组结束标记
    return concatBytes(chunks)
  }
  if (typeof value === 'object') {
    const chunks = [Uint8Array.of(0x06)]
    for (const [key, val] of Object.entries(value)) {
      if (val === undefined) continue // 与JSON.stringify语义对齐：丢弃undefined字段
      chunks.push(encodeAny(key), encodeAny(val))
    }
    chunks.push(Uint8Array.of(0xFF)) // 对象结束标记
    return concatBytes(chunks)
  }
  throw new TypeError(`MiniJsonCodec: unsupported value type: ${typeof value}`)
}

// 解码任意值（递归）：与encodeAny一一对应
function decodeAny (bytes, state) {
  const tag = bytes[state.offset++]
  switch (tag) {
    case 0x00: return null
    case 0x02: return bytes[state.offset++] === 1
    case 0x03: {
      const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
      const number = view.getFloat64(state.offset)
      state.offset += 8
      return number
    }
    case 0x04: {
      const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
      const length = view.getUint32(state.offset)
      state.offset += 4
      const raw = bytes.subarray(state.offset, state.offset + length)
      state.offset += length
      return new TextDecoder().decode(raw)
    }
    case 0x05: {
      const array = []
      while (bytes[state.offset] !== 0xFF) array.push(decodeAny(bytes, state))
      state.offset++ // 跳过结束标记
      return array
    }
    case 0x06: {
      const object = {}
      while (bytes[state.offset] !== 0xFF) {
        const key = decodeAny(bytes, state)
        object[key] = decodeAny(bytes, state)
      }
      state.offset++
      return object
    }
    default:
      throw new Error(`MiniJsonCodec: unknown tag: ${tag}`)
  }
}

// 拼接多个字节数组
function concatBytes (chunks) {
  let total = 0
  for (const chunk of chunks) total += chunk.length
  const merged = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    merged.set(chunk, offset)
    offset += chunk.length
  }
  return merged
}
```

**2. 自定义TransferProtocol：MiniJsonProtocol**

继承内置`BinaryProtocol`，复用其**全部分帧/识别/组装实现**，只更换协议码，并在初始化时注入自定义编解码器：

```javascript
// 自定义传输协议：继承标准二进制协议，换协议码 + 注入自定义默认编解码器
class MiniJsonProtocol extends BinaryProtocol {
  // 协议码：注册表以code为键，两端必须一致才能协商成功
  _code () {
    return 'MJSP'
  }

  // 可读名称
  _name () {
    return 'Mini JSON Binary Transfer Protocol'
  }

  // 覆写协议初始化：保留父级JSON(默认)/MSGPACK，再注册MJSN并设为默认
  _init () {
    super._init()
    this.usePayloadCodec(new MiniJsonCodec(), true)
  }
}
```

> 注：`@kree4js/kree4n`顶层导出的`BinaryProtocol`是**模块对象**（内含`BinaryProtocol`类、`BinaryConstants`常量与JSON/MSGPACK编解码器），继承时须取其中的类：`const { BinaryProtocol } = BinaryProtocolModule`。

**3. 注册并使用**

```javascript
// node-a：服务端节点，注册自定义协议并设为默认（useProtocol默认asDefault=true）
const callee = Kree4N.create('node-a', '服务端节点')
callee.useProtocol(new MiniJsonProtocol())
callee.register('calc', {
  sum (numbers) {
    return numbers.reduce((acc, n) => acc + n, 0)
  }
})
callee.listen('tcp://127.0.0.1:8330')
await callee.start()

// node-b：客户端节点，注册同一套自定义协议，连接并调用
const caller = Kree4N.create('node-b', '客户端节点')
caller.useProtocol(new MiniJsonProtocol())
caller.attach('tcp://127.0.0.1:8330')
await caller.start()

// 等待网格传播：让两侧发现彼此的服务
await new Promise(resolve => setTimeout(resolve, 300))

// 调用：参数数组经自定义'MJSN'编解码器传到远端
const calc = caller.service('calc')
const result = await calc.sum([10.5, 20.25, 30.125])
// 60.875
```

**4. 结构闭环验证**

未启动任何节点的前提下，可先对编解码器做手动闭环验证（任意结构 → 字节 → 还原）：

```javascript
const codec = new MiniJsonCodec()
const sample = { name: 'calc', enabled: true, ratio: 0.625, tags: ['a', 1, null], nested: { x: [1.5, 2.5] } }
const result = codec.encode(sample, {
  frameLimit: Infinity, framePduLimit: Infinity, headerLength: 0, trailerLength: 0
})
const decoded = codec.decode(result.frameResult.buffer)
// decoded.deepEqual(sample)
```

### 三. 须强调的细节

**1. 默认编解码器必须通用**

- 服务调用的载荷，只是框架流量的一部分；**网格信号同样走默认编解码器**（TCP连接非单帧模式，直接使用默认协议+默认编解码器）。
- 若自定义编解码器被设为默认，则必须能编码任意JSON结构；否则网格发现信号会在对端解码失败（典型症状：`Missing "service"`）。
- 只做特定类型的编解码器（如"只处理数字数组"），应以**非默认**编解码器注册，并通过协议层`encode(thing, codecCode)`显式使用。

**2. 协议码与编解码器码的协作**

- `TransferProtocol.code`与`PayloadCodec.code`组成`codecPairs`（如`['MJSP', 'MJSN']`），参与网格Beacon广播与协商。
- **两端必须注册同一套协议**（相同协议码、相同编解码器码），协商才能成功。
- 注册表以`code`为键：`useProtocol()`多次注册不同协议码会共存；同一协议码重复注册会覆盖。

**3. `useProtocol()`会改变默认协议**

- `KreeX.useProtocol(protocol)`默认`asDefault=true`：注册的同时把该协议设为节点默认协议。
- 默认协议决定无协商记录时的首发编码；把默认协议换掉后，后续载荷收发均走新协议。
- 想"只注册不换默认"，可在`ports`层使用`asDefault=false`（本示例未涉及）。

**4. `_encode()`返回的`PayloadEncodeResult`结构**

```typescript
{
  frameResult: {          // 帧结果（有分帧能力时为可选字段）
    buffer: Uint8Array,   // 含全部帧字节的缓冲区（帧头预留+载荷+帧尾预留）
    frames: number[][],   // 每帧的[起始偏移, 帧长度]列表
    headerLength: number,
    trailerLength: number
  },
  dataPackResult?: { pdu: Uint8Array }, // 不分帧时可选
  frameLimit: number,
  framePduLimit: number
}
```

- 单帧场景下，`buffer`从`headerLength`偏移处开始存放载荷字节，帧头/帧尾空间由框架填充。
- 载荷超过`framePduLimit`时必须自行分帧（示例未实现分帧，超限直接抛错）。

**5. `undefined`与`null`的处理**

- `undefined`编码为`null`标记（`0x00`），与`JSON.stringify`丢弃undefined字段的语义对齐。
- 对象编码时跳过`undefined`字段值；`null`照常编码并可还原为`null`。

### 四. 涉及到的API:

**1. PayloadCodec 基类**

```typescript
/**
 * 载荷编解码器：结构化数据 <-> 载荷字节的双向转换。
 */
class PayloadCodec {
  /**
   * 编解码器码：4字符，注册表与协商使用的标识。
   * @returns {string}
   * @abstract
   */
  _code(): string

  /**
   * 可读名称，用于日志与调试。
   * @returns {string}
   * @abstract
   */
  _name(): string

  /**
   * 对象 → 帧字节。
   * @param {object} payload - 待编码的对象。
   * @param {{ frameLimit: number, framePduLimit: number, headerLength: number, trailerLength: number }} options
   * @returns {{ frameResult?: { buffer: Uint8Array, frames: number[][], headerLength: number, trailerLength: number }, dataPackResult?: { pdu: Uint8Array }, frameLimit: number, framePduLimit: number }}
   * @abstract
   */
  _encode(payload: object, options: object): object

  /**
   * 载荷字节 → 对象。
   * @param {Uint8Array} pdu - 载荷字节。
   * @returns {object|undefined}
   * @abstract
   */
  _decode(pdu: Uint8Array): object|undefined
}
```

**2. TransferProtocol 基类（扩展时需实现/覆写的抽象成员）**

```typescript
/**
 * 传输协议：帧格式层。注册表以 code 为键索引。
 */
class TransferProtocol {
  /**
   * 协议码：最多4字符，识别传输协议的标识。
   * @returns {string}
   * @abstract
   */
  _code(): string

  /**
   * 协议可读名称。
   * @returns {string}
   * @abstract
   */
  _name(): string

  /**
   * 协议初始化钩子：构造时调用，用于注册载荷编解码器。
   * 默认空实现，子类可覆写。
   */
  _init(): void

  /**
   * 注册一个载荷编解码器。
   * @param {PayloadCodec} payloadCodec - 载荷编解码器实例。
   * @param {boolean} [asDefault=false] - 是否设为该协议的默认编解码器。
   * @returns {boolean} 注册成功返回true；已存在返回false。
   */
  usePayloadCodec(payloadCodec: PayloadCodec, asDefault?: boolean): boolean

  /**
   * 帧头长度（字节）。
   * @param {boolean} isEnd2End
   * @param {number} maxHops
   * @returns {number}
   * @abstract
   */
  headerLength(isEnd2End: boolean, maxHops: number): number

  /**
   * computeFramePduLimit / computeFrameLength / createDirectDataOperator /
   * _createDataPackAssembler / _createDelimiter / _createTraitIdentifier /
   * _createDataFrameCodec 等分帧识别能力，均为抽象方法。
   * 本示例通过继承BinaryProtocol复用其实现，无须覆写。
   */
}
```

**3. 节点注册协议**

```typescript
/**
 * 注册一个传输协议，并设为节点默认协议（默认asDefault=true）。
 *
 * @param {TransferProtocol} transferProtocol - 传输协议实例。
 * @returns {KreeX} 当前节点实例，支持链式调用。
 */
useProtocol(transferProtocol)

/**
 * 注销一个传输协议。
 *
 * @param {TransferProtocol} transferProtocol - 传输协议实例。
 * @returns {KreeX} 当前节点实例，支持链式调用。
 */
discardProtocol(transferProtocol)
```

### 五. 可运行代码

完整示例代码，参见：<a href="../examples/03-custom/03-payload-codec.mjs" target="_blank">03-payload-codec.mjs</a>