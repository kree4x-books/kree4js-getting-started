// built-in
import { createServer } from 'node:http'
import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

// internal
import Logging from '@kree4js/commons-logging'
import { createRequire } from 'node:module'

// owned
import Kree4n from '@kree4js/kree4n'

// module vars
Logging.setLevel('DEBUG')
const logger = Logging.getLogger('browser-webserver-interop')

const PORT = 9000
const __dirname = dirname(fileURLToPath(import.meta.url))
// 定位已安装的 @kree4js/kree4b的UMD构建产物：
// UMD只在exports的browser condition下暴露（Node默认conditions解析不到），
// 故从包入口（esm）反推包根再进入umd目录
const require = createRequire(import.meta.url)
const KREE4B_UMD_PATH = resolve(dirname(require.resolve('@kree4js/kree4b')), '../../umd/prod/index.js')
const MIME_TYPES = { '.html': 'text/html', '.js': 'application/javascript' }

/**
 * 浏览器与Web服务器双向互调示例（服务端部分）。
 *
 * - 服务端由kree4n + http-listen提供：监听http:// 端口，动态路由RPC与静态文件
 * - 浏览器端由kree4b（UMD构建产物）提供：client.html载入后通过browser-attach连接
 *
 * 关键点：
 * - 复用传入的httpServer：静态文件走自定义路由，RPC请求与WebSocket升级交给Kree4X路由
 * - http-listen提供三种信道：fetch-stream / xhr-poll / websocket，browser-attach自动协商
 * - 浏览器端点击RPC按钮，即完成一次"浏览器 → Node服务器"的远程调用
 *
 * 运行方式：
 *   1. npm install @kree4js/kree4b（npm包自带UMD构建产物）
 *   2. node examples/01-basic/13-browser-webserver-interop/server.mjs
 *   3. 浏览器打开http://localhost:9000/client.html
 */
async function main () {
  // ── 静态文件服务（client.html与kree4b UMD bundle） ──
  const httpServer = createServer()
  httpServer.on('request', (req, res) => {
    if (req.method !== 'GET') return // 其余请求交给Kree4X的RPC路由

    let filePath
    if (req.url === '/' || req.url === '/client.html') {
      filePath = resolve(__dirname, 'client.html')
    } else if (req.url === '/kree4b.js') {
      filePath = KREE4B_UMD_PATH
    } else {
      return
    }

    try {
      const content = readFileSync(filePath)
      const ext = filePath.slice(filePath.lastIndexOf('.'))
      res.writeHead(200, { 'Content-Type': MIME_TYPES[ext] || 'text/plain', 'Access-Control-Allow-Origin': '*' })
      res.end(content)
    } catch {
      res.writeHead(404).end()
    }
  })

  // ── Node（Web服务器），注册calc、greet服务 ─────────
  const node = Kree4n.create('browser-server', 'Kree4B Example RPC Server', { port: PORT })
  node.register('calc', {
    add (a, b) { return a + b },
    multiply (a, b) { return a * b }
  })
  node.register('greet', {
    sayHello (name) { return `Hello, ${name}! (from server)` },
    echo (data) { return data }
  })

  // 复用上面的httpServer：静态文件 + RPC由同一端口提供
  node.listen(`http://0.0.0.0:${PORT}`, { httpServer })

  await node.start()
  logger.info('')
  logger.info('=============================================================')
  logger.info('  Browser-WebServer RPC Server is ready!')
  logger.info(`  Listening on: http://localhost:${PORT}`)
  logger.info(`  Open http://localhost:${PORT}/client.html in a browser to connect.`)
  logger.info('  Press Ctrl+C to stop.')
  logger.info('=============================================================')
  logger.info('')
}

main().catch((err) => logger.error(err))
