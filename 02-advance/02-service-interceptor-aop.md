# 拦截调用：使用服务拦截器AOP处理服务调用及调用结果

> Created By [RV](mailto:rodney.vin@gmail.com), and licensed with Creative Commons "[CC BY-NC-ND 4.0](https://creativecommons.org/licenses/by-nc-nd/4.0/)"

**目的与场景**

在这一章，讲解如何使用 **服务拦截器**（Service Interceptor），以 **AOP（面向切面编程）** 的方式，对服务调用进行**身份认证**。

### 一. 概念

**1. AOP（面向切面编程）**

AOP是一种编程思想：把分散在业务代码中的**横切关注点**（认证、缓存、统计、日志……）抽取出来，以"切面"的方式统一处理。

业务代码不感知切面的存在，它只关心自己的业务逻辑。

Kree4X的服务拦截器体系，支持服务调用层面的AOP拦截处理。

**2. 出站拦截器：OutInterceptor**

调用发起者（Caller）侧，拦截**发起**的服务调用：

- `beforeCall`：调用发出**之前**执行——注入调用选项（如 Token）、改写参数……
- `afterCall`：调用返回**之后**执行——观察、可改写调用结果。

**3. 入站拦截器：InInterceptor**

被调用者（Callee）侧，拦截**到达**的服务调用：

- `beforeCall`：服务方法执行**之前**执行——校验通过则放行，校验失败则**拒绝调用**。
- `afterCall`：服务方法执行**之后**执行——在调用结果返回给调用者前，可进行观察、改写。

### 二. 示例代码

在下边的示例中，我们将：

- nodeA：开放 `data.getUser(id)` 服务
- nodeA：注册**入站拦截器** `TokenCheckInterceptor` 统一校验 Token
- NodeA： 注册**入站拦截器** `DataMaskInterceptor` 用 `afterCall` 统一脱敏
- nodeB：注册出站拦截器** `TokenInjectInterceptor`，自动注入合法 Token
- nodeC：不注入 Token，调用被 nodeA 拒绝

**1. 定义拦截器**

拦截器是普通对象或类，ShapeLike。

实现 `beforeCall` / `afterCall` 钩子即可：

```javascript
// ── 出站拦截器（挂在调用发起者）：自动注入 Token ────────
class TokenInjectInterceptor {
  beforeCall (ctx, cluster, method, params, options) {
    // options 随调用序列化跨网传送，"搭车"注入 Token
    options.token = TOKEN
    logger.info(`[${cluster.name}] 注入 Token: ${TOKEN}`)
  }
}

// ── 入站拦截器（挂在被调用者）：校验 Token ────────────
const TOKEN = 'secret-token'

class TokenCheckInterceptor {
  beforeCall (ctx, cluster, method, params, options) {
    const token = options?.token
    if (!this.isValidToken(token)) {
      logger.warn(`[nodeA] 拒绝非法调用: ${cluster.name}.${method}, token=${token}`)
      // 非空 IntercepResult 短路：服务方法不会执行，直接回送失败
      return { ok: false, error: new Error('Invalid token: Unauthorized') }
    }
    logger.info(`[nodeA] Token 校验通过: ${cluster.name}.${method}`)
  }

  // 校验 Token
  isValidToken (token) {
    return token === TOKEN
  }
}

// ── 入站拦截器（挂在被调用者）：afterCall 统一脱敏 ──────
class DataMaskInterceptor {
  afterCall (ctx, result, cluster, method, params, options) {
    // result 是 ServiceCallResult：{ ok, value, error }
    // 返回 undefined 保留原结果；返回非空 IntercepResult 覆盖结果
    if (result?.ok && result.value != null) {
      logger.info(`[nodeA] afterCall 脱敏: ${cluster.name}.${method}`)
      return { ok: true, value: this.mask(result.value) }
    }
    // 失败结果原样保留，不做处理
  }

  // 把对象中的手机号、身份证号打码
  mask (data) {
    const masked = { ...data }
    if (masked.phone != null) {
      masked.phone = masked.phone.replace(/^(\d{3})\d{4}(\d{4})$/, '$1****$2')
    }
    if (masked.idCard != null) {
      masked.idCard = masked.idCard.replace(/^(\d{6})\d+(\w{2})$/, '$1********$2')
    }
    return masked
  }
}
```

**2. 注册拦截器并调用**

出站拦截器挂在**调用发起者**，入站拦截器挂在**被调用者**：

```javascript
// nodeA：数据中心，开放 data 服务，入站校验 Token + 统一脱敏
const nodeA = Kree4N.create('node-a', '数据中心')
nodeA.useInInterceptor(new TokenCheckInterceptor())
nodeA.useInInterceptor(new DataMaskInterceptor())
nodeA.register('data', {
  getUser (id, ctx) {
    // 业务代码只关心返回原始数据，脱敏交给 afterCall 拦截器统一处理
    return { id, name: '张三', phone: '13812345678', idCard: '110101199001011234' }
  }
})

// nodeB：合法应用，出站自动注入 Token
const nodeB = Kree4N.create('node-b', '合法应用')
nodeB.useOutInterceptor(new TokenInjectInterceptor())

// nodeC：未授权方，不注入 Token
const nodeC = Kree4N.create('node-c', '未授权方')

// ……

// nodeB：注入token，业务代码正常调用
const dataB = nodeB.service('data')
const user = await dataB.getUser('u-1')
// { id: 'u-1', name: '张三', phone: '138****5678', idCard: '110101********34' }
// phone/idCard 已被 afterCall 统一脱敏，调用者拿不到明文

// nodeC：未注入 Token，被入站拦截器拒绝
const dataC = nodeC.service('data')
try {
  await dataC.getUser('u-1')
} catch (err) {
  logger.info('nodeC 调用被拒绝: ok=false')   // getUser 从未执行
}
```

### 三. 须强调的细节

**1. 调用发起者注册“出站拦截器”**

`useOutInterceptor()` ，**出站**拦截器，拦截当前节点**发出**的服务调用。

**2. 拦截器中，使用options跨节点传输附加数据**

拦截器`beforeCall (ctx, cluster, method, params, options)`，**options**参数是注入跨节点数据的合适位置。

出站拦截时，注入；入站拦截时，可取。

**3. 拦截，并终止服务调用**

入站拦截器 `beforeCall` 返回:

- 返回undefined|null，放行，继续后续处理。
- 返回 `IntercepResult: { ok: boolean, error:Error, value:any }`，终止处理。
- ok: false时，标记服务调用失败，异步抛出错误error
- ok: true时，标记服务调用成功，异步返回value
- 返回值不含ok属性，{error: eror}，默认为服务调用失败，{value: any}，默认为服务调用成功
- 抛出异常，或者返回Rejected Promise，自动封装为 {ok: false, error}

**4. 拦截器链：按注册顺序执行**

`beforeCall` 与 `afterCall` 都是从**第一个**注册的拦截器开始，按注册顺序依次执行。

任一拦截器返回**非空 IntercepResult**（如 `{ ok: false, error }`），链停止。

**5. 单个拦截器可同步或异步**

`beforeCall` / `afterCall` 可以返回 Promise（async 拦截器），框架会 await 后再继续。

**6. 多个拦截器，可同步异步混用**

多个拦截器时，beforeCall、afterCall同步异步混用，可被正常处理。

系统保证拦截器的顺序执行。

### 四. 涉及到的API:

**1. Kree4X节点注册出站/入站拦截器**

```typescript
/**
 * 注册一个入站拦截器（被调用者侧：拦截到达本节点的调用）。
 *
 * @param {Interceptor} interceptor - 要注册的拦截器。
 * @returns {this} 当前实例，支持链式。
 */
useInInterceptor(interceptor): this

/**
 * 注册一个出站拦截器（调用发起者侧：拦截本节点发出的调用）。
 *
 * @param {Interceptor} interceptor - 要注册的拦截器。
 * @returns {this} 当前实例，支持链式。
 */
useOutInterceptor(interceptor): this

/** 移除一个入站拦截器。 */
discardInInterceptor(interceptor): this

/** 移除一个出站拦截器。 */
discardOutInterceptor(interceptor): this
```

**2. Interceptor：拦截器协议**

实现 `beforeCall` / `afterCall` 两个钩子即可（继承 `Interceptor` 基类，或直接传普通对象/类实例）：

```typescript
/**
 * 服务调用拦截器基类：在服务调用前、后，以AOP方式注入横切逻辑。
 */
class Interceptor {
  /**
   * 在调用发出/服务执行前调用。
   *
   * 返回 undefined/null 放行，继续调用链；返回任意非空 IntercepResult
   * （{ ok, error, value }）短路——直接终止调用，并以该结果回送。
   *
   * @param {ClusterCallContext} ctx - 本次调用的上下文（含trace等）。
   * @param {ServiceCluster} serviceCluster - 被调用的服务集群。
   * @param {string} method - 被调用的方法名。
   * @param {any[]} params - 调用参数数组。
   * @param {{[key:string]:any}} [options] - 调用选项；出站侧可写，随调用跨网传送。
   * @returns {IntercepResult|undefined|Promise<IntercepResult|undefined>} 拦截结果；undefined/null 表示放行，非空 IntercepResult 表示短路。
   */
  beforeCall(ctx, serviceCluster, method, params, options)

  /**
   * 在调用结束（成功或失败）后调用，可直接改写 result。
   *
   * @param {ClusterCallContext} ctx - 本次调用的上下文。
   * @param {ServiceCallResult} result - 服务调用结果，可改写 ok/value/error。
   * @param {ServiceCluster} serviceCluster - 被调用的服务集群。
   * @param {string} method - 被调用的方法名。
   * @param {any[]} params - 调用参数数组。
   * @returns {IntercepResult|undefined|Promise<IntercepResult|undefined>} 拦截结果；undefined 表示放行。
   */
  afterCall(ctx, result, serviceCluster, method, params)
}
```

**3. IntercepResult：拦截处理的结果**

```typescript
/**
 * 拦截器返回值：非空即短路调用链；其中 ok 决定携带 value（成功）还是 error（失败）。
 */
type IntercepResult = {
  ok?: boolean           // 短路结果：true 成功携带 value，false 失败携带 error
  error?: Error          // 短路时携带的错误（调用发起者将收到该错误）
  value?: any            // 短路时携带的值（调用发起者将收到该值）
}
```

**4. ServiceCallResult：调用结果形态**

`afterCall` 的 `result` 是服务调用结果，`ok` 决定携带 `value` 还是 `error`：

```typescript
/**
 * 一次服务调用的结果：ok 决定携带 value（成功）还是 error（失败）。
 */
type ServiceCallResult = {
  ok: boolean            // 是否成功
  value: any             // ok=true 时的返回值
  error: Error           // ok=false 时的错误对象
}
```

**5. ServiceCallContext：服务方法里取调用元信息**

服务方法最后一个参数 `ctx` 是 `ServiceCallContext`，通过它可获取还原后的调用信息：

```typescript
/**
 * 单次服务调用的上下文（服务方法最后一个参数）。
 */
class ServiceCallContext {
  get serviceCall: ServiceCall   // 还原后的调用（含跨网传来的 options）
  get serviceName: string        // 服务名
  get traceId: string            // 跟踪 ID
  get nodeId: string             // 本节点 ID
}
```

### 五. 可运行代码

完整示例代码，参见：[02-service-interceptor-aop.mjs](../examples/02-advance/02-service-interceptor-aop.mjs)