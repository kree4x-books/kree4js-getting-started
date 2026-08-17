// 3rd
import { writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// internal
import { ExecUtils, PromiseUtils } from '@kree4js/commons-lang'
import Logging from '@kree4js/commons-logging'

// owned
import Kree4N, { Transports } from '@kree4js/kree4n'

// module vars
Logging.setLevel('DEBUG')
const logger = Logging.getLogger('custom-stream-receiver')

const PORT = 8097

const { Streaming: { GenericStreamReader, StreamReceiver, StreamReceiverFactory } } = Transports

// 流式数据接收：提供 StreamReceiver 处理流式数据接收。
// Node.js 环境下 kree4n 已内置 FileStreamReceiverFactory（默认所有流式接收落盘）。
// 本示例演示如何"替换默认接收器"：节点级单一工厂，直接 setStreamReceiverFactory()
// 设置自定义的校验型接收器——接收时实时校验块序号连续性（乱序/缺失即计数违规），
// 并在流完整时输出统计。

// ── 校验型流接收器：继承 StreamReceiver，实现校验与统计 ──
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

  get violations () {
    return this._violations
  }

  get totalBytes () {
    return this._totalBytes
  }
}

// ── 工厂：节点级单一工厂，create() 创建校验型接收器 ──
class ValidatingStreamReceiverFactory extends StreamReceiverFactory {
  create (streamIndex, packId) {
    return new ValidatingStreamReceiver(streamIndex, packId)
  }
}

async function main () {
  // node-a：启用流式传输，并把默认文件接收器替换为校验型接收器
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

  // node-b：流式调用方
  const nodeB = Kree4N.create('node-b', '文件发送方', {
    transport: { streaming: { enable: true } }
  })
  nodeB.attach(`tcp://127.0.0.1:${PORT}`)

  try {
    await nodeA.start()
    await nodeB.start()

    // 构造大文件（>64KB 帧缓冲，确保多帧分片）
    const filePath = join(tmpdir(), `kree4x-upload-${Date.now()}.bin`)
    writeFileSync(filePath, Buffer.alloc(300 * 1024, 0xAB))

    const result = await nodeB.service('stream').upload(new Kree4N.NodeFile(filePath))
    logger.info(`[validating-stream] 流式上传结果: ${result}`)
  } finally {
    await PromiseUtils.delay(100)
    await ExecUtils.quiet(() => nodeB.stop(), logger)
    await ExecUtils.quiet(() => nodeA.stop(), logger)
    logger.info('全部节点已停止')
  }
}

main().catch((err) => logger.error(err))
