# 开始前的准备

> Created By [RV](mailto:rodney.vin@gmail.com), and licensed with Creative Commons "[CC BY-NC-ND 4.0](https://creativecommons.org/licenses/by-nc-nd/4.0/)"

### 环境准备

所有的示例，使用纯Javascript + JSDoc编写。

- NodeJS，>= V22
- VSCode，作为集成开发环境
- Git，拉取示例代码

### 下载此书及其示例代码库：

```shell
git clone git@github.com:kree4x-books/kree4js-getting-started.git
```

### 构建工程

切换到工程根目录：

```shell
npm i
node examples/01-basic/03-register-invoke-service.mjs
```

> 03-register-invoke-service.mjs 演示了完整的创建节点、连接、注册服务、调用服务全过程：
>
> 输出：
>
>  [Info] [node-b] 调用 [node-a].calc.add(10, 20) = 30
>  [Info] [node-b] 调用 [node-a].greeter.hello('Kree4JS') = Hello, Kree4JS!

### 可运行代码

npm安装依赖后，examples目录下，是所有的可运行示例。

每个章节，会根据当前章节上下文，重点讲解对应示例代码的片段。

章节正文中的代码，不完整，仅是重点片段，完整代码，从example目录打开、运行。

### 有问题？

如有可能，不要手工。

打开你的AI IDE，使用自然语言，指挥它干活。

手工敲命令行，配置环境，实际有点傻。