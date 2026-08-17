# 扩展载荷编解码：自定义PayloadCodec

> Created By [RV](mailto:rodney.vin@gmail.com), and licensed with Creative Commons "[CC BY-NC-ND 4.0](https://creativecommons.org/licenses/by-nc-nd/4.0/)"

**目的与场景**

RPC的本质，就是将调用相关的数据，序列化与反序列化后，通过信道传送，调用远程的开放的过程、方法。

“调用相关的数据”，就是载荷，“Payload”。

而如何将“调用相关的数据”序列化、反序列化，就是载荷编码器“PayloadCodec”的职责。

Kree4X內建提供了PayloadJsonCodec，与PayloadMsgpackCodec两个编解码器。

在这一章，我们将讲解如何自定义自己的PayloadCodec，并将其注入Kree4X服务节点，替换默认实现。

### 一. 概念

**1. Payload是什么**

Payload，在Kree4X的体系内，实际是特指`TransferableThing.payload`。

什么是“**TransferableThing**”，参见[可传送物：TransferableThing](https://zhuanlan.zhihu.com/p/2035006431427022978)

Payload，实际是TransferableThing所携带的业务数据，实际数据类型是`{[key:string]:any}`，一个可以包含任意属性的平数据对象。

**2. PayloadCodec是什么**

PayloadCodec，负责上述“**平数据对象**”与Uint8Array二进制格式之间的双向转换。

- `_encode(payload:{[key:string]:any}, options):PayloadEncodeResult`：对象 → 编码结果，编码结果中封装了编码后的字节Uint8Array。
- `_decode(pdu:Uint8Array):{[key:string]:any}`：载荷字节 → 对象

**3. PayloadEncodeResult.*dataPackResult***

PayloadCodec的输出结果之一，是*dataPackResult。*

如果输出的PayloadEncodeResult包含dataPackResult属性，则代表：

- 之所以叫“**dataPackResult**”， 是因为`dataPackResult.pdu`可以直接赋值给`DataPack.pdu`
- 意味着，未分帧，输出的是一个留待后续切分的完整的DataPack.pdu

**4. PayloadEncodeResult.frameResult**

PayloadCodec的另外一种输出结果，是*frameResult。*

```typescript
{
  buffer: Uint8Array,   // all frame bytes, include metadata and payload data
  frames: number[][],   // start byte offset and length for each frame
  headerLength: number,
  trailerLength: number,
}
```

如果输出的PayloadEncodeResult包含frameResult属性，则代表：

- 之所以叫做“**frameResult**”，`frameResult.buffer`是所有DataFrame首尾相接组成的完整内存区
- 意味着，分帧已经完成，frames: number[][]指明了每个frame的起始偏移、长度

**5. 为什么需要frameResult？**

零拷贝，Zero-Copy，性能，这是唯一的设计目标。

在PayloadCodec编码时，分配一个连续的内存区，在编组的过程中，直接将切分完毕的各个Frame.pdu放置到连续内存区的指定位置。

这样，可以避免小容量、多次、频繁的内存分配和回收。

> 內建的PayloadJsonCodec，输出frameResult。
>
> 实际机制，很简单。
>
> JSON.stringify()将payload转换为string后，定量获取指定字节数的字符，使用TextEncoder可以写入连续内存区的指定位置：
>
> 1. 在连续内存区buffer中，计算destination
>
> 2. **TextEncoder.encodeInto**(*source*: string, *destination*: Uint8Array<ArrayBufferLike>):TextEncoderEncodeIntoResult
> 3. TextEncoderEncodeIntoResult.written指明写入字节数，即frame.pdu的长度
>
> 这可以避免TextEncoder.encode()分配内存，然后再copy到目标内存区的开销。

**6. usePayloadCodec()：注入Kree4X实例**

Kree4X提供了下述API，用于注入自定义的PayloadCodec：

- `Ports.usePayloadCodec(payloadCodec, asDefault)`：全局注入一个载荷编解码器，`asDefault=true`时将该编解码器设为**默认编解码器**。
- `kree4x.ports.transport.defaultProtocol.usePayloadCodec(payloadCodec, asDefault)`：向指定Kree4X节点注入一个载荷编解码器，`asDefault=true`时将该编解码器设为**默认编解码器**。
- Kree4X初始化时，已注入`PayloadJsonCodec`（默认）与`PayloadMsgpackCodec`两种编码器。
- 将自定义编解码器注入**并设为默认**，即可替换默认实现。

### 二. 示例代码

在下边的示例中，我们将：

1. **注入**：把自定义`PayloadCodec`：`MiniJsonCodec`注入节点默认协议，`asDefault=true`设为默认编解码器，替换内置`PayloadJsonCodec`
2. 实现一个自定义`PayloadCodec`：`MiniJsonCodec`，用"类型标记+递归"的迷你自描述格式，简化版MessagePack，实现任意JSON结构的紧凑二进制序列化
3. **编解码验证**：进行编解码测试，验证任意JSON结构，经`MiniJsonCodec`编码/解码可完整还原
4. **端到端服务调用**：callee/caller 两端注入`MiniJsonCodec`并设为默认，发起真实RPC，验证参数对象与返回值对象均经`MJSN`双向编解码

> 注意：此示例无任何生产级意义，未经完善的覆盖测试、未经平台兼容性测试

**1. 注入PayloadCodec：usePayloadCodec()**

节点级注入：创建节点后，向默认协议注入自定义编解码器，并设为默认：

```javascript
// 节点级注入：向默认协议注入自定义编解码器并设为默认
const node = Kree4N.create('node-codec-demo')
const defaultProtocol = node.ports.transport.defaultProtocol
defaultProtocol.usePayloadCodec(new MiniJsonCodec(), true)
```

**2. 自定义PayloadCodec：MiniJsonCodec**

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
// （示意：省略递归序列化/反序列化的具体实现，完整代码见03-payload-codec.mjs）
class MiniJsonCodec extends PayloadCodec {
  // 可读名称
  _name () {
    return 'Mini JSON Codec'
  }

  // Kree4X节点内唯一，4字符代码，不超过4字节
  _code () {
    return 'MJSN'
  }

  // 对象 → 编码结果：
  // - 单帧场景：返回frameResult（完整帧字节buffer + 帧边界frames + 帧头/帧尾长度）
  // - 超限且不可切分：返回dataPackResult（纯载荷PDU，由框架整包发送）
  _encode (payload, options) {
    // encodeAny(payload)：按上方类型标记表递归序列化
    // body.length <= framePduLimit → frameResult
    // body.length >  framePduLimit → dataPackResult { pdu: body }
  }

  // 载荷字节 → 对象：按类型标记递归还原（与encodeAny一一对应）
  _decode (pdu) {
    // decodeAny(pdu)：类型标记表逆序还原
  }
}
```

> 注：递归序列化与反序列化的完整实现（`encodeAny`/`decodeAny`/`concatBytes`，类定义之后的独立函数），以及所有验证代码，见下方「可运行代码」链接。

**3. 闭环测试验证**

不引入任何Kree4X节点，对编解码器做手动闭环验证。

任意结构 → 字节 → 还原，并特别覆盖`undefined`字段的丢弃语义：

```javascript
const codec = new MiniJsonCodec()
const samples = [
  { name: 'calc', enabled: true, ratio: 0.625, tags: ['a', 1, null], nested: { x: [1.5, 2.5] } },
  { a: 1, dropped: undefined, c: null }, // undefined字段在编码时被丢弃（与JSON.stringify对齐）
  'hello',
  42,
  true,
  null,
  [1, 'two', false, null]
]
for (const sample of samples) {
  const result = codec.encode(sample, {
    frameLimit: Infinity, framePduLimit: Infinity, headerLength: 0, trailerLength: 0
  })
  const decoded = codec.decode(result.frameResult.buffer)
  // decoded.deepEqual(sample)
}
```

**4. 端到端服务调用验证**

callee/caller两端都注入`MiniJsonCodec`，并设为默认，两端一致，数据才能互相解码。

发起真实RPC调用，参数对象与返回值对象均经`MJSN`双向编解码：

```javascript
// callee：注入MJSN -> 注册服务 -> 监听
const callee = Kree4N.create('node-a', '服务端节点')
callee.ports.transport.defaultProtocol.usePayloadCodec(new MiniJsonCodec(), true)
callee.register('calc', {
  sum (params) {
    const { values, scale = 1 } = params ?? {}
    const total = values.reduce((acc, n) => acc + n, 0)
    return { label: params?.label ?? 'sum', total: total * scale, count: values.length }
  }
})
callee.listen('tcp://127.0.0.1:8330')
await callee.start()

// caller：注入MJSN -> 连接
const caller = Kree4N.create('node-b', '客户端节点')
caller.ports.transport.defaultProtocol.usePayloadCodec(new MiniJsonCodec(), true)
caller.attach('tcp://127.0.0.1:8330')
await caller.start()

// 等待网格发现：等对端节点在本节点可见（whenReady，5s超时）
await caller.whenReady(callee, 5000)

// 调用：参数对象与返回值对象均经MJSN双向编解码
const calc = caller.service('calc')
const result = await calc.sum({ label: 'MJSN链路', values: [10.5, 20.25, 30.125], scale: 2 })
// result = { label: 'MJSN链路', total: 121.75, count: 3 }
```

### 三. 须强调的细节

**1. 不可对Payload的结构做任何假定**

PayloadCodec，必须能处理任意结构平数据对象。

不能处理给定的Payload时，抛出异常。

**2. Caller、Callee两端都要注入**

仅在一端注入自定义Codec，数据在另一端将无法识别，无法解码。

如将自定义Codec设置为默认，应多个Kree4X节点同时设为默认，避免不必要的协议协商。

**3. 关于JSON.stringify()与JSON.parse()**

没事干，没有特殊需求，不要去碰瓷V8引擎的`JSON.stringify()`与`JSON.parse()`。

一般来讲，你，我，包括AI，做的绝大部分优化，都是负优化。

这是，在RPS性能、内存调优过程中，得到的惨痛教训。

### 四. 涉及到的API:

**1. PayloadCodec 基类**

```typescript
/**
 * 载荷编解码器：结构化数据 <-> 载荷字节的双向转换。
 */
class PayloadCodec {
  /**
   * 编解码器码：4字符代码（不超过4字节），注册表与协商使用的标识。
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
   * 对象 → 载荷字节，并给出帧边界（frameResult）或整包PDU（dataPackResult）。
   *
   * @param {{[key:string]:any}} payload - 待编码的对象。
   * @param {{
   *   frameLimit: number,      // 帧大小上限。
   *   framePduLimit: number,   // 单帧载荷（PDU）上限。
   *   headerLength: number,    // 帧头预留字节数。
   *   trailerLength: number    // 帧尾预留字节数。
   * }} options - 编码选项。
   * @returns {{
   *   frameResult?: { // 如已分帧，返回。
   *     buffer: Uint8Array, // 所有帧首尾相接存放的内存区
   *     frames: number[][], // 各帧的起始位置，和总长度
   *     headerLength: number, // 每帧的帧头长度
   *     trailerLength: number // 每帧的尾区长度
   *   },
   *   dataPackResult?: { // 无法切分时返回，pdu为dataPack.pdu，纯序列化载荷（不含任何元数据）
   *     pdu: Uint8Array
   *   },
   *   frameLimit: number, // 每帧的最大长度
   *   framePduLimit: number // 每帧pdu的最大长度
   * }} 编码结果。
   * @abstract
   */
  _encode(payload, options): PayloadEncodeResult

  /**
   * 载荷字节 → 对象。
   * @param {Uint8Array} pdu - 载荷字节。
   * @returns {{[key:string]:any}|undefined}
   * @abstract
   */
  _decode(pdu): {[key:string]:any}|undefined
}
```

**2. 注入自定义PayloadCodec的API**

```typescript
/**
 * 注册一个载荷编解码器。
 *
 * @param {PayloadCodec} payloadCodec - 载荷编解码器实例。
 * @param {boolean} [asDefault=false] - 设为默认编解码器。默认false（仅注册）。
 */

// 全局注入（Ports）：返回当前实例，支持链式调用。
Ports.usePayloadCodec(payloadCodec: PayloadCodec, asDefault?: boolean): this

// 节点级注入（kree4x.ports.transport.defaultProtocol，即默认协议实例）：
// 返回boolean：新增注册返回true；已存在（仅切换默认标记）或协议未初始化返回false。
kree4x.ports.transport.defaultProtocol.usePayloadCodec(payloadCodec: PayloadCodec, asDefault?: boolean): boolean
```

### 五. 可运行代码

完整示例代码，参见：<a href="../examples/03-custom/03-payload-codec.mjs" target="_blank">03-payload-codec.mjs</a>
