// built-in
import { execSync } from 'node:child_process'
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// internal
import { ExecUtils } from '@kree4js/commons-lang'
import Logging from '@kree4js/commons-logging'
import Kree4n from '@kree4js/kree4n'

// vars
Logging.setLevel('DEBUG')
const logger = Logging.getLogger('http2-protocol')

/**
 * HTTP/2 协议连接示例：两个NodeJS节点通过HTTP/2协议互联，进行双向RPC调用。
 *
 * - nodeA（https2-listen）：创建HTTP/2服务器（TLS），监听端口，注册calc服务
 * - nodeB（https2-attach）：以HTTP/2客户端身份连接到nodeA，注册str服务
 *
 * 关键点：
 * - HTTP/2 需要 TLS 证书，服务端使用自签证书（openssl 临时生成）
 * - 客户端使用 rejectUnauthorized: false 跳过证书校验（仅演示用）
 * - 一条 stream = 一个 channel，原生多路复用，无需 WebSocket 升级
 *
 * 调用流程：
 *   node-b 调用 node-a 的 calc 服务
 *   node-a 调用 node-b 的 str 服务（双向互调）
 */
async function main () {
  // ── 生成自签证书（HTTP/2 over TLS 需要证书） ──────
  const { key, cert, tempDir } = createSelfSignedCerts()

  // ── Node A（HTTP/2 服务器，注册calc服务） ─────────
  const nodeA = Kree4n.create('node-a', 'HTTP/2 RPC server')
  nodeA.register('calc', {
    add (a, b) { return a + b },
    multiply (a, b) { return a * b }
  })
  nodeA.listen('https2://127.0.0.1:8050', { key, cert })

  // ── Node B（HTTP/2 客户端，注册str服务） ─────────
  const nodeB = Kree4n.create('node-b', 'HTTP/2 RPC client')
  nodeB.register('str', {
    echo (msg) { return `Echo: ${msg}` },
    greet (name) { return `Hello, ${name}! (via HTTP/2)` }
  })
  nodeB.attach('https2://127.0.0.1:8050', { rejectUnauthorized: false })

  try {
    await nodeA.start()
    logger.info('[nodeA] HTTP/2 listening on https2://127.0.0.1:8050')

    await nodeB.start()
    logger.info('[nodeB] HTTP/2 connected to nodeA')

    // node-b 调用 node-a 的 calc 服务
    const calc = nodeB.service('calc')
    const addResult = await calc.add(10, 20)
    const mulResult = await calc.multiply(6, 7)
    logger.info(`[nodeB] node-a.calc.add(10, 20) = ${addResult}`)
    logger.info(`[nodeB] node-a.calc.multiply(6, 7) = ${mulResult}`)

    // node-a 调用 node-b 的 str 服务（双向）
    const str = nodeA.service('str')
    const echoResult = await str.echo('HTTP/2 works!')
    const greetResult = await str.greet('World')
    logger.info(`[nodeA] node-b.str.echo('HTTP/2 works!') = ${echoResult}`)
    logger.info(`[nodeA] node-b.str.greet('World') = ${greetResult}`)
  } finally {
    await ExecUtils.quiet(() => nodeB.stop(), logger)
    logger.info(`${nodeB}，已停止`)
    await ExecUtils.quiet(() => nodeA.stop(), logger)
    logger.info(`${nodeA}，已停止`)
    rmSync(tempDir, { recursive: true, force: true })
  }
}

main().catch((err) => logger.error(err))

/**
 * 生成自签证书（HTTP/2 over TLS 需要证书）。
 *
 * 使用 openssl 在系统临时目录生成，仅用于本地演示。
 *
 * @returns {{ key: Buffer, cert: Buffer, tempDir: string }} 证书内容及临时目录路径（用于清理）。
 */
function createSelfSignedCerts () {
  const tempDir = mkdtempSync(join(tmpdir(), 'kree4js-http2-'))
  const keyPath = join(tempDir, 'server-key.pem')
  const certPath = join(tempDir, 'server-cert.pem')
  const extPath = join(tempDir, 'san.cnf')
  // SAN 配置让自签证书对 localhost/127.0.0.1 生效；无 SAN 时 TLS 校验证书主机名会失败
  writeFileSync(extPath, '[req]\ndistinguished_name=req\n[v3_req]\nsubjectAltName=DNS:localhost,IP:127.0.0.1')
  execSync(`openssl req -x509 -newkey rsa:2048 -keyout "${keyPath}" -out "${certPath}" -days 1 -nodes -subj "/CN=localhost" -extensions v3_req -config "${extPath}"`)
  return {
    key: readFileSync(keyPath),
    cert: readFileSync(certPath),
    tempDir
  }
}
