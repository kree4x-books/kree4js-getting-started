# Worker池：大载荷编解码卸载，主进程不被阻塞

> Created By [RV](mailto:rodney.vin@gmail.com), and licensed with Creative Commons "[CC BY-NC-ND 4.0](https://creativecommons.org/licenses/by-nc-nd/4.0/)"

**目的与场景**

NodeJS，适合IO密集的应用，在IO的空隙进行适量的CPU处理，整体RPS可以逆天。

如果您的应用，是CPU计算密集的，NodeJS“**单进程、无线程**”的编程模型，则会构成一个无解的叹息之墙。

RPC中，调用参数、调用结果的序列化及反序列化，是CPU计算密集的。

这意味着，大数据、深度多层、复杂的对象序列化，会卡住NodeJS的事件循环，RPS、P50/P90延迟等性能指标，会惨不忍睹。

解决方法，有两个：

- 启用NodeJS Cluster，这是运维层的解决办法。

- 启用Worker，这是开发层的解决办法。

当负载大于一定阈值后，将序列化/反序列化任务，零拷贝(Zero-Copy)卸载到Worker中，才可以维持主进程的高RPS、低延迟、稳定延迟特性。

在这一章，讲解如何在Kree4X中开启Worker池，将服务调用的编解码任务，卸载到独立的Worker进程，避免主进程事件循环阻塞，导致RPS、P50、P90等指标大幅劣化。

### 一. 概念

**1. 编解码：主进程与Worker进程之分**

默认情况下，载荷编解码在主进程中执行，和其他调用处理共享主进程事件循环。

负载过小，转移到Worker进程，“转移”本身的开销会大于“负载编解码”的开销，得不偿失。

**2. Worker池：WorkerPool**

开启Worker模式后，Kree4X会启动一个Worker池，包含一个或多个独立的Worker进程。

大载荷的编解码，卸载到Worker进程执行，主进程只负责帧的组装与分发，不再被大载荷编解码阻塞。

**3. 卸载阈值：threshold**

创建Kree4X节点时，可通过`worker.threshold`参数指定卸载阈值，不设定时，默认为32KB。

主进程与Worker进程的数据交换，使用的是IPC协议。

进程间IPC通信也是有开销的，大载荷使用Worker处理，才能值回IPC本身的开销。

**4. Worker数量：workerCount**

Worker池中的Worker进程数量，默认为1。

创建Kree4X节点时，可通过`worker.workerCount`参数设定。

**5. Worker能大幅提升整体RPS?**

不要抱有任何不切实际的幻想。

NodeJS应用，要大幅提升整体RPS，要靠NodeJS Cluster。否则一个CPU内核干活，其他几十个袖手旁观，这是极其荒谬的。

启用Worker的主要目的，是保住主进程的Event Loop不要卡死，保证绝大多数的小负载请求的P50、P90延迟。

大负载，需要大量的CPU计算，不论放在哪里，这个“计算”都是逃避不掉的。

划个圈，把所有的怪物都扔到里面让它们自萌，这是Worker方案唯一的显著效果。

**6. 单实例基准 vs 生产集群**

在我14款的古董MBP上，未启用Worker，跑了一个简单的Kree4X单实例基准测试，仅供参考：[RPC RPS 破10K了](https://www.zhihu.com/pin/2041624399175013319)

生产环境，启用Worker的同时，请采用集群，原生NodeJS Cluster或者PM2 Cluster，都可。

### 二. 示例代码

在下边的示例中，我们将：

- 创建一个开启了Worker模式的节点，监听tcp端口
- 创建另一个普通节点，连接并调用
- 分别用小载荷与大载荷调用，验证调用正常完成

```javascript
import Kree4n from '@kree4js/kree4n'

// callee：创建节点时，通过options.worker开启Worker模式
// - workerCount: 2 —— 启动2个Worker进程
// - threshold: 64KB —— 载荷超过64KB，编解码卸载到Worker进程
const callee = Kree4n.create('node-a', '', {
  worker: {
    workerCount: 2,
    threshold: 64 * 1024
  }
})
callee.listen('tcp://127.0.0.1:8130')

// caller：普通节点，不开启Worker模式
const caller = Kree4n.create('node-b')
caller.attach('tcp://127.0.0.1:8130')

await callee.start()
await caller.start()

// 数据暂存服务：echo() 原样返回收到的载荷
const store = {
  echo (data) {
    return data
  }
}
callee.register('store', store)

const storeStub = caller.service('store')

// 小载荷调用：低于阈值，主进程直接处理
const small = await storeStub.echo('hello')

// 大载荷调用：128KB载荷，超过64KB阈值，编解码卸载到Worker进程
const payload = 'x'.repeat(128 * 1024)
const result = await storeStub.echo(payload)
```

### 三. 须强调的细节

**1. 小载荷不经Worker**

载荷不超过阈值时，主进程直接编解码，不经过Worker进程，避免IPC开销。

**2. 生命周期随Transport**

Worker池的生命周期由Transport管理。

服务节点启动时，启动Worker池，节点停止时，停止Worker池，所有Worker进程被终止销毁。

**3. 请求超时保护**

Worker池的编解码请求有超时保护，超时标记为失败，避免Worker异常导致的无限挂起。

**4. Worker进程是长期复用的进程**

Kree4X的Worker池，只负责编解码，不承载业务逻辑。

Worker进程在节点生命周期内长期复用，不会为每次调用创建销毁进程。

### 四. 涉及到的API

**1. 创建节点时开启Worker模式**

```typescript
/**
 * 创建Kree4X节点。
 *
 * @param {string} name - 节点名称。
 * @param {string} description - 节点描述。
 * @param {Object} [options] - 节点选项。
 * @param {Object} [options.worker] - Worker模式配置。
 * @param {number} [options.worker.workerCount] - Worker数量，默认1。
 * @param {number} [options.worker.threshold] - 卸载阈值（字节），默认32 * 1024。
 * @param {string} [options.worker.runtimeScript] - Worker入口脚本路径（默认自动注入，一般无需设置）。
 * @returns {KreeX} 配置好的KreeX节点。
 */
create(name, description, options?): KreeX
```

**2. 节点创建后开启Worker模式**

```typescript
/**
 * 开启Worker模式。
 *
 * Worker池由Transport管理生命周期：Transport.start()时启动，Transport.stop()时停止。
 *
 * @param {Object} config - Worker配置。
 * @param {number} [config.workerCount] - Worker数量，默认1。
 * @param {number} [config.threshold] - 卸载阈值（字节），默认32 * 1024。
 * @param {string} [config.runtimeScript] - Worker入口脚本路径（默认自动注入，一般无需设置）。
 * @returns {this} 当前节点，支持链式。
 */
enableWorker(config): this
```

### 五. 可运行代码

完整示例代码，参见：<a href="../examples/02-advance/13-worker-pool.mjs" target="_blank">13-worker-pool.mjs</a>