# 证书提供者：提供TLS证书

> Created By [RV](mailto:rodney.vin@gmail.com), and licensed with Creative Commons "[CC BY-NC-ND 4.0](https://creativecommons.org/licenses/by-nc-nd/4.0/)"

**目的与场景**

Kree4X使用https/tls协议时，通过listen(url, options)/attach(url, options)的options参数可以传入证书信息。

这是一种硬编码，这会带来运维阶段，动态维护的困难。

此外，还存在动态直连协商的问题，在无人干预、动态直连的过程中，如何获得相关证书？

在这一章，我们讲解如何通过CertificateProvider机制，获得运行时动态获取、维护签名证书的能力。

### 一. 概念

**1. TLS证书**

TLS（Transport Layer Security），是一种加密网络传输协议。
而TLS机制，通过证书（X.509数字证书）来解决"如何信任对方"的问题：

- 证书 = 身份信息（如域名/CN）+ 公钥 + 签发者（CA）签名
- 私钥（key）与证书（cert）配对：私钥仅持有者掌握，用于证明"我是证书声明的那个实体"
- 客户端用证书链（ca）校验服务端身份是否可信，防止中间人攻击
- 身份校验通过后，双方派生会话密钥，后续数据加密传输

**2. 如何获得TLS证书** 

TLS连接的双方（server/client）在建立前都需要证书或信任策略：

- **listen侧（server）**：purpose为`'server'`，需要私钥 + 证书（`key`/`cert`）。
- **attach侧（client）**：purpose为`'client'`，需要信任策略（`ca`/`rejectUnauthorized`）。默认`rejectUnauthorized: true`，自签名证书会被拒。

TLS证书，有三种获取方式：

- **自签名证书**：自己生成，例如`openssl req -x509 -newkey rsa:2048 ...`，但客户端默认不信任，适合开发环境。
- **免费证书**：由公共CA免费签发，如`Let's Encrypt`。可使用`certbot`，自动化续期，可被浏览器与系统默认信任。
- **商业证书**：向商业CA（如DigiCert、GlobalSign）购买，提供更高级别验证（OV/EV）与品牌信任背书。适用于对信任等级有严格要求的生产环境。

**3. CertificateProvider**

Kree4X提供的扩展接口，基于Providers机制，允许开发者提供自己的编程式证书方案。

当Kree4X服务节点，需要建立 `tls://` 连接时，框架构造 `CertificateRequest` ，并调用已注册提供者的 `provide(request)`，得到 `CertificateSolution`。

```javascript
// CertificateRequest，框架创建，调用CertificateProvider.provide(request)时传入
{ protocol: 'tls', hostname, port, mode, purpose: 'server'|'client' }

// CertificateSolution，CertificateProvider.provide(request)返回值
{ key?, cert?, ca?, rejectUnauthorized?, requestCert?, secureProtocol?, ... }
```

### 二. 示例代码

在下边的示例中，我们实现一个**动态证书提供者**。

TLS Server侧，证书提供者在运行时生成并缓存。

TLS Client侧，由同一提供者给出信任策略。

示例演示，如何把外部证书系统（PKI/Secret管理）注入到Kree4X服务节点。

**1. 定义提供者**

```javascript
// 提供者：识别tls协议，按purpose签发/信任证书
class SimpleCertificateProvider extends CertificateProvider {
  constructor () {
    super()
    this.__cached = undefined
  }

  name () {
    return 'SimpleCertificateProvider'
  }

  // 能否处理指定的CertificateRequest？
  understands (request) {
    return request.protocol.toLowerCase() === 'tls'
  }

  // 为指定的CertificateRequest，创建CertificateSolution
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
      // ⚠️ attach侧：信任自签名证书，演示环境跳过校验
      return { rejectUnauthorized: false }
    }
    return undefined
  }
}
```

**2. 注册并使用**

```javascript
const certProvider = new SimpleCertificateProvider()

// node-a：TLS服务端，证书由自定义提供者签发
const nodeA = Kree4N.create('node-a', 'TLS服务端')
// 注入CertificateProvider
nodeA.useCertificateProvider(certProvider)
nodeA.register('secure', {
  hello (name) {
    return `Hello ${name}`
  }
})
// tls连接时，自动获取证书
nodeA.listen(`tls://127.0.0.1:${PORT}`)
await nodeA.start()

// node-b：TLS客户端，证书信任策略由同一提供者管理
const nodeB = Kree4N.create('node-b', 'TLS客户端')
// 注入CertificateProvider
nodeB.useCertificateProvider(certProvider)
// tls连接时，自动获取证书
nodeB.attach(`tls://127.0.0.1:${PORT}`)
await nodeB.start()

const result = await nodeB.service('secure').hello('tls-cert')
// Hello tls-cert
```

### 三. 须强调的细节

**1. Listen server与Attach client需要分别注入Provider**

两个Kree4X节点，都需要注入CertificateProvider。

示例中，使用同一个CertificateProvider注入到两个不同的Kree4X服务节点，并且同时处理Listen/Attach两种情景。

实际生产环境，同一个Kree4X实例，可能既作为TLS Server，也Attach到其他TLS Server，所以使用同一个CertificateProvider来同时处理Listen/Attach，是合理的。

但是，实际生产环境，服务节点分布在不同服务器上，必然需要注入不同的CertificateProvider来负责证书管理。

**2. 默认校验策略拒绝自签名证书**

Attach侧默认`rejectUnauthorized: true`，自签名证书会被Node.js拒绝。

演示环境由CertificateProvider返回`{ rejectUnauthorized: false }`跳过校验。

生产环境应返回`ca`（信任的CA证书），执行完整的CA校验链。

**3. `useCertificateProvider(provider, asDefault)`**

-  `asDefault`：是否设为默认提供者，understands()未匹配到任何Provider时，使用default作为回退。
- `discardCertificateProvider(provider)`：移除指定的provider
- 多提供者：按注册顺序，获取到第一个`understands()`为true的Provider，则停止查找

**4. ALPN是Kree4X的传输约定**

TLS握手后节点还会校验ALPN协议标识（`ALPNProtocol.Kree4X`），不匹配会断开。

框架层自动处理，证书提供者无需关心，但自定义TLS栈时需保持一致。

**5. 证书生成**

示例用`openssl` CLI生成自签名证书，macOS/Linux自带openssl。

生产环境：

- 读取 Kubernetes Secret
- 调用 Vault API
- 从文件系统热加载，轮换时提供者返回新证书，无需节点重启

### 四. 涉及到的API:

**1. CertificateProvider基类**

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
   * 提供证书方案（TLS选项）。
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
  purpose?: string      // 'server'（listen侧）| 'client'（attach侧）
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

完整示例代码，参见：<a href="../examples/03-custom/06-certificate-provider.mjs" target="_blank">06-certificate-provider.mjs</a>