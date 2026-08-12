// 3rd
import { createWriteStream, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { fileURLToPath } from 'node:url'

// internal
import { ExecUtils } from '@kree4js/commons-lang'
import Logging from '@kree4js/commons-logging'

// owned
import Kree4n from '@kree4js/kree4n'

// module vars
Logging.setLevel('DEBUG')
const logger = Logging.getLogger('streaming-data')

const { NodeFile } = Kree4n

// 工程根目录下的tmp/（相对脚本位置examples/01-basic → ../../tmp），用于存放下载文件。
const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const PROJECT_TMP_DIR = join(__dirname, '../../tmp')

/**
 * Streaming：流式的调用参数、流式的调用结果。
 *
 * 演示两个Kree4X节点之间的RPC调用如何携带流式数据：
 * - nodeA（tcp-listen）：监听TCP端口，注册stream服务（接收流参数、返回流结果）
 * - nodeB（tcp-attach）：以客户端身份连接nodeA，进行流式调用
 *
 * 关键点：
 * - 默认关闭：kree4n默认不启用流式传输，创建节点时需要显式传 { transport: { streaming: { enable: true } } }
 * - 参数：调用方传入一个StreamReader，如文件流（NodeFile），被调方同位置参数收到一个StreamReader
 * - 调用结果：被调方return一个StreamReader，如文件流（NodeFile），调用方收到一个StreamReader
 * - 缓冲发送：streaming.frameSize（默认64KB）控制流读取缓冲帧大小，读满，或流结束，触发一次发送
 *
 * 调用流程：
 * - nodeB上传一个文件给nodeA（流的参数）
 * - nodeB请求nodeA返回一个文件，保存到工程tmp目录（流的结果）
 */

async function main () {
  // ── Node A（服务提供方：接收流参数、返回流结果） ─────────────
  // streaming默认关闭（Streaming.Enable=false），必须显式enable: true才能使用流式调用
  const nodeA = Kree4n.create('node-a', 'Streaming RPC server', {
    transport: { streaming: { enable: true } }
  })
  nodeA.register('stream', {
    // 接收流参数：流是AsyncIterable（StreamReader），直接逐块消费并统计
    upload: async (streamReader) => {
      let total = 0
      let count = 0
      for await (const chunk of streamReader) {
        total += chunk.byteLength
        count++
      }
      return `received ${count} chunks (${total} bytes)`
    },

    // 返回文件：NodeFile基于磁盘文件流式读取，作为流结果返回
    download: () => {
      return new NodeFile(createTempFile('kree4x streaming file content'))
    }
  })
  nodeA.listen('tcp://127.0.0.1:8096')

  // ── Node B（调用方） ─────────────
  const nodeB = Kree4n.create('node-b', 'Streaming RPC client', {
    transport: { streaming: { enable: true } }
  })
  nodeB.attach('tcp://127.0.0.1:8096')

  try {
    // 确保工程tmp目录已就绪（下载文件的落盘位置）
    mkdirSync(PROJECT_TMP_DIR, { recursive: true })

    await nodeA.start()
    logger.info('[nodeA] Streaming enabled, listening on tcp://127.0.0.1:8096')
    await nodeB.start()

    const streamSvc = nodeB.service('stream')

    // 1. 上传文件：NodeFile基于磁盘文件流式读取，作为流参数上传给node-a
    const uploadFile = new NodeFile(createTempFile('kree4x streaming file content'))
    const uploadResult = await streamSvc.upload(uploadFile)
    logger.info(`[nodeB] stream.upload(${uploadFile.name}, ${uploadFile.size} bytes) => ${uploadResult}`)

    // 2. 下载文件：调用结果是远端文件流（FileStreamReader），保存到工程tmp目录
    const downloadedFile = await streamSvc.download()
    const downloadPath = join(PROJECT_TMP_DIR, downloadedFile.name)
    await saveFileStream(downloadedFile, downloadPath)
    logger.info(`[nodeB] stream.download() => saved to ${downloadPath} (${downloadedFile.size} bytes)`)
  } finally {
    await ExecUtils.quiet(() => nodeB.stop(), logger)
    logger.info(`${nodeB}，已停止`)
    await ExecUtils.quiet(() => nodeA.stop(), logger)
    logger.info(`${nodeA}，已停止`)
  }
}

/**
 * 创建带已知内容的临时文件，返回文件路径。
 *
 * @param {string} content - 文件内容字符串。
 * @returns {string} 临时文件路径。
 */
function createTempFile (content) {
  const filePath = join(tmpdir(), `kree4x-streaming-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.txt`)
  writeFileSync(filePath, content)
  return filePath
}

/**
 * 把异步可迭代流（AsyncIterable）逐块写入本地文件。
 *
 * @param {AsyncIterable<Uint8Array>} reader - 流读取器（如FileStreamReader）。
 * @param {string} filePath - 目标文件路径。
 * @returns {Promise<void>} 写入完成时resolve。
 */
async function saveFileStream (reader, filePath) {
  await pipeline(Readable.from(reader), createWriteStream(filePath))
}

main().catch((err) => logger.error(err))
