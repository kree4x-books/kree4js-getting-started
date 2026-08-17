// internal
import { ExecUtils, PromiseUtils } from '@kree4js/commons-lang'
import Logging from '@kree4js/commons-logging'
import Kree4N, { BinaryProtocol as BinaryProtocolModule, Transports } from '@kree4js/kree4n'

// module vars
Logging.setLevel('DEBUG')
const logger = Logging.getLogger('payload-codec')

const { PayloadCodec } = Transports
const { BinaryProtocol } = BinaryProtocolModule

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
    if (body.length > framePduLimit) {
      throw new Error(`MiniJsonCodec: payload ${body.length}B exceeds framePduLimit ${framePduLimit}B (multi-frame not implemented)`)
    }
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
 * 自定义传输协议：继承标准二进制协议（复用其分帧/识别/组装实现），
 * 更换协议码，并在初始化时注入自定义编解码器并设为默认。
 *
 * 注：Kree4N 顶层直接导出 BinaryProtocol 模块对象（含 BinaryProtocol 类、常量与
 * JSON/MSGPACK 编解码器），这里取其中的 BinaryProtocol 类继承。
 */
class MiniJsonProtocol extends BinaryProtocol {
  /**
   * 返回协议码：注册表以 code 为键，两端必须一致才能协商成功。
   *
   * @returns {string} 协议码。
   */
  _code () {
    return 'MJSP'
  }

  /**
   * 返回协议可读名称。
   *
   * @returns {string} 协议名称。
   */
  _name () {
    return 'Mini JSON Binary Transfer Protocol'
  }

  /**
   * 覆写协议初始化：保留父级JSON(默认)/MSGPACK编解码器，注册自定义编解码器并设为默认。
   */
  _init () {
    super._init()
    this.usePayloadCodec(new MiniJsonCodec(), true)
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
 * - 自定义载荷编解码器（PayloadCodec）：MiniJsonCodec（MJSN），类型标记+递归的字节流格式
 * - 自定义传输协议（TransferProtocol）：继承BinaryProtocol换协议码（MJSP），把MJSN设为默认编解码器
 * - useProtocol() 注册协议；两端协商一致后，服务调用与网格信号的载荷均用'MJSN'双向编解码
 *
 * @returns {Promise<void>} 调用完成时 resolve。
 */
async function main () {
  // 手动闭环验证：任意结构 <-> 字节流
  const sample = { name: 'calc', enabled: true, ratio: 0.625, tags: ['a', 1, null], nested: { x: [1.5, 2.5] } }
  const codec = new MiniJsonCodec()
  if (JSON.stringify(codec.decode(codec.encode(sample, { frameLimit: Infinity, framePduLimit: Infinity, headerLength: 0, trailerLength: 0 }).frameResult.buffer.subarray(0))) !== JSON.stringify(sample)) {
    throw new Error('MiniJsonCodec round-trip failed')
  }
  logger.info('[validate] MiniJsonCodec 结构闭环验证通过')

  // ── callee：注册自定义协议，然后监听 ────────────────
  const callee = Kree4N.create('node-a', '服务端节点')
  // useProtocol()：注册协议并设为默认（KreeX.useProtocol默认asDefault=true）
  callee.useProtocol(new MiniJsonProtocol())
  callee.register('calc', {
    sum (numbers) {
      return numbers.reduce((acc, n) => acc + n, 0)
    }
  })
  callee.listen('tcp://127.0.0.1:8330')
  await callee.start()
  logger.info('[node-a] 已启动，监听tcp://127.0.0.1:8330，默认协议：MJSP + MJSN')

  // ── caller：注册同一套自定义协议，连接并调用 ──────────
  const caller = Kree4N.create('node-b', '客户端节点')
  caller.useProtocol(new MiniJsonProtocol())
  caller.attach('tcp://127.0.0.1:8330')
  await caller.start()
  logger.info('[node-b] 已启动，已连接到 [node-a]')

  // 等待网格传播：让两侧发现彼此的服务
  await new Promise(resolve => setTimeout(resolve, 300))

  // 调用：参数数组经自定义'MJSN'编解码器传到远端
  const calc = caller.service('calc')
  const result = await calc.sum([10.5, 20.25, 30.125])
  logger.info(`[node-b] calc.sum([10.5, 20.25, 30.125]) = ${result}（期望 60.875）`)

  // 停止前留出在途帧的送达窗口
  await PromiseUtils.delay(100)
  await ExecUtils.quiet(() => callee.stop(), logger)
  logger.info('[node-a] 已停止')
  await ExecUtils.quiet(() => caller.stop(), logger)
  logger.info('[node-b] 已停止')
}

main().catch((err) => logger.error(err))
