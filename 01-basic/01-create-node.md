# 创建Kree4X服务节点

> Created By [RV](mailto:rodney.vin@gmail.com), and licensed with Creative Commons "[CC BY-NC-ND 4.0](https://creativecommons.org/licenses/by-nc-nd/4.0/)"

**目的与场景**

在这一章，讲解如何使用Kree4N，创建Kree4X服务节点。

注意，“**Kree4X**服务节点”，而不是Kree4JS、Kree4N，或者Kree4B。

因为，服务节点是**For X**的，它可以被跨语言连接和调用。

### 一. 概念

**1. 服务节点**

所谓服务节点，就是一个Kree4X实例。

**2. 节点标识**

一个服务节点，有其全局唯一的节点标识。

节点标识，是一个ULID，有Kree4X动态创建，内部分配，不能由外部设定。

**3. 节点名称**

节点名称，是一个服务节点的人类可读的名称。

节点标识不可读，节点描述太长，节点名称是人类一眼可识别。

可能重复，节点名称由人类设定，不保证唯一性。

**4. 节点描述**

节点详细的文字描述。

### 二. 创建节点

在这里，我们仅仅创建节点：

- 不启动节点
- 不建立网络连接

然后，简单输出：节点标识(id)、名称(name)、描述信息(description)。

```javascript
// 使用KreeX For NodeJS，內建了各种NodeJS可用的扩展插件
import Kree4n from '@kree4js/kree4n'

// 方式1：仅指定name
const node1 = Kree4n.create("node-1");
// -> node1 id: 01KZDVSWC9NRSBGW46VYEA44VZ, name: node-1

// 方式2：指定name + description
const node2 = Kree4n.create("node-2", "A demo node");
// -> node2 id: 01KZDVZ4XSZ8FM35M1GN4CZM6V, name: node-2, desc: A demo node

// kree4N默认內建的通信协议
// HttpListenConnectionProvider
// HttpAttachConnectionProvider
// TcpListenConnectionProvider
// TcpAttachConnectionProvider
// UdpListenConnectionProvider
// UdpAttachConnectionProvider
// SocketioListenConnectionProvider
// SocketioAttachConnectionProvider
// Http2ListenConnectionProvider
// Http2AttachConnectionProvider
```

### 三. 须强调的细节

**1. Kree4N**

“@kree4js/kree4n”，是For NodeJS实现。

默认內建了大量的各种通信协议、Tracing Formatter、Writer等只能在NodeJS端运行的插件。

服务器，使用这个版本。

**2. Kree4B**

“@kree4js/kree4b”，是For Browser实现

內建了在浏览器中建立XHR、WebSocket、Fetch等连接的插件。

Web客户端，使用这个版本。

**3. Kree4JS**

"@kree4js/kree4js"，是面向Javascript的通用版本，不包含任何平台特异的代码。

所以，这是个纯粹的、极简版“框架”。

唯一的好处：精简，没有多余的东西。基于这个极简版，您可以按需注入插件。

例如，只注入TcpListenConnectionProvider，仅在服务器端使用。

### 四. 涉及到的API

**1. 创建Kree4N实例Kree4n.create()**

创建一个Kree4X实例，并注入Kree4N插件

```typescript
/* 
 * @param {string} name - KreeX节点的名称。
 * @param {string} description - 人类可读的描述。
 * @param {{
 *   worker?: { workerCount?: number, threshold?: number },
 *   transport?: TransportOptions;
 *   [key:string]: any
 * }} [options]
 * @returns {import('@kree4js/kree4js').KreeX}
 */
function create(name: string, description: string, options?: {
    worker?: {
        workerCount?: number;
        threshold?: number;
    };
    transport?: TransportOptions;
    [key: string]: any;
}): import("@kree4js/kree4js").KreeX
```



### 五. 可运行代码

完整示例代码，参见：[01-create-node.mjs](../examples/01-basic/01-create-node.mjs)