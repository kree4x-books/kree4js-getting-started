# 前言

> Created By [RV](mailto:rodney.vin@gmail.com), and licensed with Creative Commons "[CC BY-NC-ND 4.0](https://creativecommons.org/licenses/by-nc-nd/4.0/)"

### Kree4JS是什么？

Kree4JS，是Kree4X的Javascript语言版本实现。

实际，其内部包含两个变体：

- Kree4N = Kree4NodeJS
- Kree4B = Kree4Browser

### Kree4X是什么？

要准确的描述Kree4X是什么，说起来话比较长。

**功能，简单列一下：**

- 透明RPC，纯方法调用的方式调用远程服务
- 微服务，基于透明RPC构建支持浏览器、Web服务器、后端微服务节点的微服务网格
- 将NodeJS Callback风格的函数，开放为服务，callback支持结果可感知
- 将NodeJS EventEmitter风格的对象，开放为服务，事件处理结果可感知

**非功能特性，简单列一下：**

- 简单、对服务实现无侵入。纯函数、普通Class、普通Object即是服务，无任何继承、注入、注解。
- No Schema，不要求在服务层定义Schema
- 服务与通信分离，底层通信协议是http、tcp、udp……，服务是不感知，也不关心的
- 异构通信网格，支持将不同通信协议(http、tcp、udp……)融合为一个统一的通信网格，跨异构节点通信
- 服务动态性，“**概念想定**”、“**我思故我在**”方式进行RPC服务调用
- 去中心化的动态服务发现，不依赖于任何服务注册表机制，实现服务动态发现
- Tracing是第一等公民，基于Action，以服务调用为粒度，动态、自动进行全栈跨节点调用栈、通信站追踪
- 原生服务治理，支持服务发现、服务选择、结果合并的动态治理
- 多语言支持，Kree4Py、Kree4J……

更详细的内容，推荐去看理论书：[KreeX-RPC:  重构面向AI Programming服务调用范式](https://zhuanlan.zhihu.com/p/2028042363268776710)

### 为什么需要Kree4X？

**面向AI Programming，面向AI编程。**

**为了，且仅为了**，这一个目标。

详情，可参阅：[AI持有契约：Schema In AI，Not Service](https://zhuanlan.zhihu.com/p/2068345562911527586)

为了这一个目标，进行特异化设计。一切为了AI编程而优化，AI First，AI Native。

虽然，客观导致，人类程序员使用Kree4X进行开发，也会更容易理解、更容易编写、更容易维护，但是，这是副作用，不是我们的起意和原始意图。

要了解全貌，开全图，通读:

- [面向AI Programming的软件工程范式思考与实践](https://zhuanlan.zhihu.com/p/2027041298343838694)
- [面向AI Programming的软件工程范式](https://zhuanlan.zhihu.com/p/2028183632976585299)
- [AI驱动的“架构工程”-可视化、工程化生成SPEC](https://zhuanlan.zhihu.com/p/2043309578897581930)
- [KreeX-RPC:  重构面向AI Programming服务调用范式](https://zhuanlan.zhihu.com/p/2028042363268776710)
- [AI时代的前端工程: 问题、目标、方法与方案](https://zhuanlan.zhihu.com/p/2061416478805582965)

### 为什么叫Kree4X？

参见：[KreeX名字的由来](https://zhuanlan.zhihu.com/p/2027768382783595045)

简单讲：

- 需要一个名字
- 有“创造”的欲望
- 需要牵强一个由来

### 快速开始

要快速开始使用框架，直接忽略后续的两篇理论性的“**前言2、前言3**”，直接跳到基础篇即可。

如果，向更多了解Kree4X的设计架构、目的、设计取舍的倾向，可以读一下前言2、前言3。

前言2、前言3，本是Kree4X理论书的内容。

之所以，放在这里，是因为Kree4X的很多设计取舍，为了AI Coding的便利，太过“**反模式**”。

先浅读一下，前言2、前言3，可以做一下后冲击的铺垫。