// internal
import { ExecUtils, PromiseUtils } from '@kree4js/commons-lang'
import Logging from '@kree4js/commons-logging'
import Kree4N, { Transports } from '@kree4js/kree4n'

// module vars
Logging.setLevel('DEBUG')
const logger = Logging.getLogger('payload-codec')

const { PayloadCodec } = Transports

/**
 * @typedef {import('@kree4js/kree4js/types/transports/payload-codec').PayloadEncodeOptions} PayloadEncodeOptions
 * @typedef {import('@kree4js/kree4js/types/transports/payload-codec').PayloadEncodeResult} PayloadEncodeResult
 */

/**
 * 自定义载荷编解码器：任意可序列化结构 <-> 紧凑二进制字节流（迷你JSON）。
 *
 * 为什么默认载荷编解码器必须是"通用自描述格式"：
 * - 服务调用的载荷只是KreeX流量的一部分；网格发现(WhoHas)、Beacon、Tracing等内部信号
 *   同样经过默认编解码器传输出网。
 * - 因此把自定义编解码器设为默认时，它必须能编码任意JSON结构，否则网格信号会在
 *   对端解码失败（例如WhoHasSignal丢失service字段）。
 *
 * 本实现采用"类型标记 + 递归"的迷你自描述格式（类似简化版MessagePack）：
 *   0x00 null      0x02 bool(1B)    0x03 number(8B float64)  0x04 string(4B len + utf8)
 *   0x05 array(元素序列 + 0xFF结束)   0x06 object(key/value序列 + 0xFF结束)
 */
class MiniJsonCodec extends PayloadCodec {
  /**
   * Returns the Human-Readable name of Codec.
   *
   * @returns {string} The codec name.
   */
  _name () {
    return 'Mini JSON Codec'
  }

  /**
   * Return the 4-chars code of Codec.
   *
   * At most 4 bytes; unique within a Kree4X node.
   *
   * @returns {string} The codec code.
   */
  _code () {
    return 'MJSN'
  }

  /**
   * Encodes the payload object into frame bytes.
   *
   * @param {{[key:string]:any}} payload - The payload object to encode.
   * @param {PayloadEncodeOptions} options - The encode options.
   * @returns {PayloadEncodeResult} The encoded payload result.
   */
  _encode (payload, options) {
    const { frameLimit = Infinity, framePduLimit = Infinity, headerLength = 0, trailerLength = 0 } = options
    const body = encodeAny(payload)
    // Single frame case: payload fits in one frame.
    // buffer is the complete frame bytes: [frame header area][payload][frame trailer area],
    // protocol metadata is written into the header/trailer areas by the framework later.
    // Zero-copy: the framework slices this shared buffer by frames (subarray views, no copy)
    // and transfers the ArrayBuffer directly (e.g. worker transferList).
    if (body.length <= framePduLimit) {
      const frameLength = headerLength + body.length + trailerLength
      const buffer = new Uint8Array(frameLength)
      buffer.set(body, headerLength)
      return {
        frameResult: {
          buffer,
          frames: [[0, frameLength]],
          headerLength,
          trailerLength
        },
        frameLimit,
        framePduLimit
      }
    }
    // Multi-frame case: MiniJson byte stream cannot be split (self-contained tag stream,
    // any cut breaks decoding). Return the pure serialized payload as dataPackResult,
    // the framework sends it as one whole data pack (same as built-in MSGPACK codec).
    return {
      dataPackResult: {
        pdu: body
      },
      frameLimit,
      framePduLimit
    }
  }

  /**
   * Decodes the PDU bytes back into the payload object.
   *
   * @param {Uint8Array} pdu - The protocol data unit.
   * @returns {{[key:string]:any}|undefined} The decoded payload.
   */
  _decode (pdu) {
    const state = { offset: 0 }
    const value = decodeAny(pdu, state)
    if (state.offset !== pdu.length) {
      throw new Error(`MiniJsonCodec: $${state.offset} consumed, but pdu length is $${pdu.length}`)
    }
    return value
  }
}

/**
 * 编码任意值（递归）：null/boolean/number/string/array/object。
 *
 * - undefined 编码为 null（0x00），与 JSON.stringify 丢弃 undefined 字段的语义对齐。
 * - object 仅保留 value !== undefined 的键。
 *
 * @param {any} value - 待编码的值。
 * @returns {Uint8Array} 编码后的字节。
 */
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
    chunks.push(Uint8Array.of(0xFF))
    return concatBytes(chunks)
  }
  if (typeof value === 'object') {
    const chunks = [Uint8Array.of(0x06)]
    for (const [key, val] of Object.entries(value)) {
      if (val === undefined) continue
      chunks.push(encodeAny(key), encodeAny(val))
    }
    chunks.push(Uint8Array.of(0xFF))
    return concatBytes(chunks)
  }
  throw new TypeError(`MiniJsonCodec: unsupported value type: ${typeof value}`)
}

/**
 * 解码任意值（递归）：与 encodeAny 一一对应。
 *
 * @param {Uint8Array} bytes - 编码字节。
 * @param {{offset: number}} state - 游标状态（跨递归共享）。
 * @returns {any} 解码后的值。
 */
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
      state.offset++
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

/**
 * 拼接多个字节数组。
 *
 * @param {Uint8Array[]} chunks - 待拼接的字节数组。
 * @returns {Uint8Array} 拼接结果。
 */
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

/**
 * 演示内容：
 * - 注入：把自定义载荷编解码器MiniJsonCodec（MJSN）注入节点默认协议并设为默认，
 *   替换内置PayloadJsonCodec（JSON）成为默认编解码器。
 * - 自定义载荷编解码器（PayloadCodec）：MiniJsonCodec（MJSN），类型标记+递归的字节流格式。
 * - 闭环验证（不启动任何节点）：
 *   1. 任意JSON结构（对象/数组/字符串/数字/布尔/null，含undefined字段丢弃语义）经 encode -> decode 完整还原。
 *   2. 超帧PDU上限且不可切分时，返回 dataPackResult（纯载荷PDU），decode(pdu) 同样完整还原。
 * - 端到端服务调用：callee/caller 两端都注入MJSN并设为默认，发起真实RPC，
 *   参数对象与返回值对象均经MJSN双向编解码。
 *
 * @returns {Promise<void>} 验证完成时 resolve。
 */
async function main () {
  // ── 1. 注入：向默认协议注入MiniJsonCodec并设为默认 ──────────
  const node = Kree4N.create('node-codec-demo')
  const defaultProtocol = node.ports.transport.defaultProtocol
  const before = defaultProtocol.defaultPayloadCodec.code
  defaultProtocol.usePayloadCodec(new MiniJsonCodec(), true)
  const after = defaultProtocol.defaultPayloadCodec.code
  logger.info(`[inject] 默认编解码器替换：${before} -> ${after}（注入MiniJsonCodec并设为默认）`)
  await node.stop()

  // ── 2. 闭环验证：任意结构 <-> 字节流（含undefined字段丢弃语义） ──
  const codec = new MiniJsonCodec()
  const samples = [
    { name: 'calc', enabled: true, ratio: 0.625, tags: ['a', 1, null], nested: { x: [1.5, 2.5] } },
    { a: 1, dropped: undefined, c: null },
    'hello',
    42,
    true,
    null,
    [1, 'two', false, null]
  ]
  for (const sample of samples) {
    const result = codec.encode(sample, { frameLimit: Infinity, framePduLimit: Infinity, headerLength: 0, trailerLength: 0 })
    const decoded = codec.decode(result.frameResult.buffer)
    if (JSON.stringify(decoded) !== JSON.stringify(sample)) {
      throw new Error(`MiniJsonCodec round-trip failed for ${JSON.stringify(sample)}`)
    }
  }
  logger.info('[validate] MiniJsonCodec 常规闭环验证通过（含undefined字段丢弃语义）')

  // 超限且不可切分：必须返回 dataPackResult（纯载荷PDU），而非抛错或截断
  const big = { list: Array.from({ length: 200 }, (_, i) => i) }
  const bigResult = codec.encode(big, { frameLimit: Infinity, framePduLimit: 64, headerLength: 0, trailerLength: 0 })
  if (bigResult.dataPackResult == null) {
    throw new Error('MiniJsonCodec: oversize payload should return dataPackResult')
  }
  const bigDecoded = codec.decode(bigResult.dataPackResult.pdu)
  if (JSON.stringify(bigDecoded) !== JSON.stringify(big)) {
    throw new Error('MiniJsonCodec oversize round-trip failed')
  }
  logger.info('[validate] MiniJsonCodec 超限不可切分场景验证通过（dataPackResult 整包PDU直发）')

  // ── 3. 端到端服务调用：callee/caller两端注入MJSN并设为默认，发起真实RPC ──
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
  logger.info('[node-a] 已启动，监听tcp://127.0.0.1:8330，默认编解码器：MJSN')

  const caller = Kree4N.create('node-b', '客户端节点')
  caller.ports.transport.defaultProtocol.usePayloadCodec(new MiniJsonCodec(), true)
  caller.attach('tcp://127.0.0.1:8330')
  await caller.start()
  logger.info('[node-b] 已启动，已连接到 [node-a]，默认编解码器：MJSN')

  // 等待网格传播：让两侧发现彼此的服务
  await new Promise(resolve => setTimeout(resolve, 300))

  // 参数对象与返回值对象均经MJSN双向编解码
  const params = { label: 'MJSN链路', values: [10.5, 20.25, 30.125], scale: 2 }
  const calc = caller.service('calc')
  const result = await calc.sum(params)
  if (result.total !== 121.75 || result.count !== 3 || result.label !== 'MJSN链路') {
    throw new Error(`e2e call failed: ${JSON.stringify(result)}`)
  }
  logger.info(`[node-b] calc.sum(${JSON.stringify(params)}) = ${JSON.stringify(result)}（期望total=121.75，经MJSN双向编解码）`)

  // 停止前留出在途帧的送达窗口
  await PromiseUtils.delay(100)
  await ExecUtils.quiet(() => callee.stop(), logger)
  logger.info('[node-a] 已停止')
  await ExecUtils.quiet(() => caller.stop(), logger)
  logger.info('[node-b] 已停止')
}

main().catch((err) => logger.error(err))
