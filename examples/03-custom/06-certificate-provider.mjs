// 3rd
import { execSync } from 'node:child_process'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// internal
import { ExecUtils, PromiseUtils } from '@kree4js/commons-lang'
import Logging from '@kree4js/commons-logging'

// owned
import Kree4N, { Transports } from '@kree4js/kree4n'

// module vars
Logging.setLevel('DEBUG')
const logger = Logging.getLogger('custom-certificate')

const PORT = 8095

const { CertificateProvider } = Transports

// 证书提供者：为安全连接（tls://）动态提供证书。
// 生产环境常把证书托管在集中式系统（如PKI/Secret管理），
// 本示例演示如何通过CertificateProvider把这些系统接入Kree4X：
//  - server侧（listen tls）：返回自签名证书（示例用openssl动态生成）
//  - client侧（attach tls）：信任该自签名证书（rejectUnauthorized: false）
// 证书只生成一次并缓存，所有连接共用。

// ── 提供者：识别tls协议，按purpose签发/信任证书 ────
class SimpleCertificateProvider extends CertificateProvider {
  constructor () {
    super()
    this.__cached = undefined
  }

  name () {
    return 'SimpleCertificateProvider'
  }

  understands (request) {
    return request.protocol.toLowerCase() === 'tls'
  }

  provide (request) {
    if (request.purpose === 'server') {
      // listen侧：生成一次自签名证书并缓存
      if (this.__cached == null) {
        const dir = mkdtempSync(join(tmpdir(), 'kree4x-cert-'))
        const keyPath = join(dir, 'server-key.pem')
        const certPath = join(dir, 'server-cert.pem')
        execSync(
          `openssl req -x509 -newkey rsa:2048 -keyout "${keyPath}" -out "${certPath}" -days 1 -nodes -subj "/CN=localhost"`
        )
        this.__cached = {
          key: readFileSync(keyPath),
          cert: readFileSync(certPath)
        }
        logger.info('[cert] 已生成自签名证书并缓存')
      }
      return this.__cached
    }
    if (request.purpose === 'client') {
      // attach侧：信任自签名证书（演示环境跳过校验）
      return { rejectUnauthorized: false }
    }
    return undefined
  }
}

async function main () {
  const certProvider = new SimpleCertificateProvider()

  // node-a：TLS服务端，提供证书由自定义提供者签发
  const nodeA = Kree4N.create('node-a', 'TLS服务端')
  nodeA.useCertificateProvider(certProvider)
  nodeA.register('secure', {
    hello (name) {
      return `Hello ${name}`
    }
  })
  nodeA.listen(`tls://127.0.0.1:${PORT}`)
  await nodeA.start()

  // node-b：TLS客户端，证书信任策略由同一提供者管理
  const nodeB = Kree4N.create('node-b', 'TLS客户端')
  nodeB.useCertificateProvider(certProvider)
  nodeB.attach(`tls://127.0.0.1:${PORT}`)
  await nodeB.start()

  // 等待网格发现：等对端节点在本节点可见（whenReady，5s超时）
  await nodeB.whenReady(nodeA, 5000)

  const result = await nodeB.service('secure').hello('tls-cert')
  logger.info(`[cert] 跨节点TLS调用成功: ${result}`)

  // 停止前留出在途帧的送达窗口
  await PromiseUtils.delay(100)
  await ExecUtils.quiet(() => nodeB.stop(), logger)
  await ExecUtils.quiet(() => nodeA.stop(), logger)
  logger.info('全部节点已停止')
}

main().catch((err) => logger.error(err))
