# 服务调用重试：使用retry设置调用重试策略

> Created By [RV](mailto:rodney.vin@gmail.com), and licensed with Creative Commons "[CC BY-NC-ND 4.0](https://creativecommons.org/licenses/by-nc-nd/4.0/)"

在这一章，讲解如何为服务调用设置重试策略，应对瞬时故障。

### 一. 概念

**重试（Retry）**

服务调用失败时，自动重新尝试。

重试策略包含两个参数：

- `maxRetries`：最大调用次数（含首次调用）
- `delay`：每次重试之间的间隔（毫秒）

**适用场景**

- 网络抖动导致的瞬时失败
- 服务节点短暂不可用
- 高并发下的临时过载

### 二. 设置重试策略

```javascript
import Kree4n from '@kree4js/kree4n'

// 创建并启动两个节点
const nodeA = Kree4n.create('node-a')
const nodeB = Kree4n.create('node-b')

nodeA.listen('tcp://127.0.0.1:8080')
nodeB.attach('tcp://127.0.0.1:8080')

await nodeA.start()
await nodeB.start()
await nodeA.whenReady(nodeB, 5_000)

// 注册一个可能失败的服务
nodeB.register('org.example.FlakyService', {
  echo: (data) => {
    if (Math.random() < 0.5) {
      throw new Error('transient error')
    }
    return data
  }
})

// 获取服务桩，设置重试策略
const service = nodeA.service('org.example.FlakyService')
service.timeout(5000) // 超时5秒
service.retry(3, 100) // 最多3次调用，间隔100ms

// 调用服务，失败时会自动重试
const result = await service.echo('hello')
```

### 三. 须强调的细节

**retry(3, 100) 的含义**

- 首次调用失败后，最多重试2次
- 总共最多3次调用（1次原始 + 2次重试）
- 每次重试间隔100ms

**重试与超时**

重试和超时是独立的：

- `timeout` 控制单次调用的超时时间
- `retry` 控制失败后的重试次数和间隔

建议同时设置两者，避免重试导致的整体耗时过长。

### 四. 可运行代码

完整示例代码，参见：[12-retry-policy.mjs](../examples/02-advance/12-retry-policy.mjs)
