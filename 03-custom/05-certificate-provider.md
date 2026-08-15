# 证书提供者：提供TLS证书

> Created By [RV](mailto:rodney.vin@gmail.com), and licensed with Creative Commons "[CC BY-NC-ND 4.0](https://creativecommons.org/licenses/by-nc-nd/4.0/)"

**目的与场景**

`tls://` 协议为节点间通信提供传输加密。证书由谁签发、如何信任、如何动态管理，是扩展点：本章讲**证书提供者**（`CertificateProvider`），把证书的"供给"从硬编码配置抽离为可编程的能力。

### 一. 概念

**1. 证书从哪来**

TLS 连接的双方（server/client）在建立前都需要证书或信任策略：

| 侧 | purpose | 需要 | 默认 |
|----|---------|------|------|
| listen 侧（server） | `'server'` | 私钥 + 证书（`key`/`cert`） | 无提供者则无法启用 TLS 服务端 |
| attach 侧（client） | `'client'` | 信任策略（`ca`/`rejectUnauthorized`） | 默认 `rejectUnauthorized: true`（自签名证书会被拒） |

**2. CertificateProvider 的职责**

`CertificateProvider` 是一个"证书适配器"：节点建立 `tls://` 连接时，框架构造 `CertificateRequest` 并调用已注册提供者的 `provide(request)`，得到 `CertificateSolution`（即 TLS options）。

```javascript
// CertificateRequest（框架构造）
{ protocol: 'tls', hostname, port, mode, purpose: 'server'|'client' }

// CertificateSolution（提供者返回，即 Node.js TLS 选项）
{ key?, cert?, ca?, rejectUnauthorized?, requestCert?, secureProtocol?, ... }
```

**3. 查找顺序**

`transport.ports.resolveCertificate(request)` → `certificateProviders.canUnderstand(request)` → 第一个 `understands(request)` 为 true 的提供者 → `provide(request)`。没有匹配的提供者时返回 `undefined`（attach 侧按系统默认 TLS 行为，listen 侧通常无法建立）。

### 二. 示例代码

在下边的示例中，我们实现一个**动态证书提供者**：证书不预先写在配置里，而是由提供者在运行时生成（openssl 自签名）并缓存；client 侧由同一提供者给出信任策略。演示如何把外部证书系统（PKI / Secret 管理）接入 Kree4X。

**1. 定义提供者**

```javascript
// 提供者：识别 tls 协议，按 purpose 签发/信任证书
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
      // listen 侧：生成一次自签名证书并缓存
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
      // attach 侧：信任自签名证书（演示环境跳过校验）
      return { rejectUnauthorized: false }
    }
    return undefined
  }
}
```

**2. 注册并使用**

```javascript
const certProvider = new SimpleCertificateProvider()

// node-a：TLS 服务端，证书由自定义提供者签发
const nodeA = Kree4N.create('node-a', 'TLS 服务端')
nodeA.useCertificateProvider(certProvider)
nodeA.register('secure', {
  hello (name) {
    return `Hello ${name}`
  }
})
nodeA.listen(`tls://127.0.0.1:${PORT}`)
await nodeA.start()

// node-b：TLS 客户端，证书信任策略由同一提供者管理
const nodeB = Kree4N.create('node-b', 'TLS 客户端')
nodeB.useCertificateProvider(certProvider)
nodeB.attach(`tls://127.0.0.1:${PORT}`)
await nodeB.start()

const result = await nodeB.service('secure').hello('tls-cert')
// Hello tls-cert
```

运行输出要点：

```
[cert] 已生成自签名证书并缓存
[cert] 跨节点 TLS 调用成功: Hello tls-cert
全部节点已停止
```

### 三. 须强调的细节

**1. server 与 client 是两次独立的提供**

`provide()` 会分别以 `purpose: 'server'`（listen 侧建立 TLS 服务时）和 `purpose: 'client'`（attach 侧连接时）被调用。一个提供者负责两侧是常见做法，也可以用两个不同提供者分开管理。

**2. 默认校验策略拒绝自签名证书**

attach 侧默认 `rejectUnauthorized: true`，自签名证书会被 Node.js 拒绝。演示环境由提供者返回 `{ rejectUnauthorized: false }` 跳过校验；生产环境应返回 `ca`（信任的 CA 证书）做完整校验链。

**3. `useCertificateProvider(provider, asDefault)`**

- 第二个参数 `asDefault`：是否设为默认提供者（未匹配到 understands 时回退）
- `discardCertificateProvider(provider)`：移除
- 多个提供者可共存：按注册顺序，第一个 `understands()` 为 true 者生效

**4. ALPN 是 Kree4X 的传输约定**

TLS 握手后节点还会校验 ALPN 协议标识（`ALPNProtocol.Kree4X`），不匹配会断开——证书提供者无需关心，但自定义 TLS 栈时需保持一致。

**5. 证书生成方式自由**

示例用 `openssl` CLI 生成自签名证书（macOS/Linux 自带）。生产实现可以是：读取 Kubernetes Secret、调用 Vault API、从文件系统热加载（证书轮换时提供者返回新证书，无需重启节点）。

### 四. 涉及到的API:

**1. CertificateProvider 基类**

```typescript
/**
 * 证书提供者：为安全连接（tls://）提供证书或信任策略。
 */
class CertificateProvider {
  /**
   * 提供者的名字。
   * @returns {string}
   */
  name(): string

  /**
   * 是否处理该证书请求。
   * @param {CertificateRequest} request - 证书请求。
   * @returns {boolean} 处理返回 true。
   */
  understands(request: CertificateRequest): boolean

  /**
   * 提供证书方案（TLS 选项）。
   * @param {CertificateRequest} request - 证书请求。
   * @returns {CertificateSolution|undefined} TLS 选项；不提供返回 undefined。
   * @abstract
   */
  provide(request: CertificateRequest): CertificateSolution|undefined
}
```

**2. CertificateRequest / CertificateSolution**

```typescript
type CertificateRequest = {
  protocol: string      // 协议名，如 'tls'
  hostname?: string     // 目标主机
  port?: number         // 目标端口
  mode: string          // 连接模式：attach / listen
  purpose?: string      // 'server'（listen 侧）| 'client'（attach 侧）
}

type CertificateSolution = {
  key?: Buffer|string|Array<Buffer|string>
  cert?: Buffer|string|Array<Buffer|string>
  ca?: Buffer|string|Array<Buffer|string>
  rejectUnauthorized?: boolean
  requestCert?: boolean
  secureProtocol?: string
  ciphers?: string
  honorCipherOrder?: boolean
  ALPNProtocols?: string[]
  SNICallback?: (servername: string, cb: (err: Error|null, ctx: any) => void) => void
  servername?: string
}
```

**3. 节点注册/移除证书提供者**

```typescript
/**
 * 注册一个证书提供者。
 *
 * @param {CertificateProvider} certificateProvider - 证书提供者。
 * @param {boolean} [asDefault=false] - 是否设为默认提供者。
 * @returns {KreeX} 当前节点实例，支持链式调用。
 */
useCertificateProvider(certificateProvider, asDefault?)

/**
 * 移除已注册的证书提供者。
 *
 * @param {CertificateProvider} certificateProvider - 证书提供者。
 * @returns {KreeX} 当前节点实例，支持链式调用。
 */
discardCertificateProvider(certificateProvider)
```

### 五. 可运行代码

完整示例代码，参见：<a href="../examples/03-custom/05-certificate-provider.mjs" target="_blank">05-certificate-provider.mjs</a>