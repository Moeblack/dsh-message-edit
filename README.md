# DSH Message Edit

为 DeepSeek Harness 提供消息编辑、重生成、回合重试和分支版本导航。每次操作创建新版本，原会话历史保持不变。

本仓库是 [Moeblack/dsh-message-edit](https://github.com/Moeblack/dsh-message-edit) 的二次开发分支，保留上游 git 历史；当前适配 **DeepSeek Harness 0.2.1-rc.2**、**Session 格式 v4**，包版本 **0.4.0**。

## 功能

- 编辑已完成回合的用户文本、助手思考及助手回复。
- 重生成最后一个已完成助手回复所属回合，或重试指定历史回合。
- `truncate`：仅重新执行目标输入，旧后续历史保留在原版本。
- `preserve`：后续用户输入依次重新执行，助手输出和工具链重新生成。
- 标题栏提供撤销、重做和重生成；Timeline 提供版本树、历史编辑和回合重试。
- Chat 行内按钮按当前 DSH 节点标识定位，仅作用于所属会话面板，不按文本匹配。Timeline 可编辑未显示在 Chat 中的历史文本块。

## 本地构建

要求 Node 满足 DSH 的 engines，目标 DSH checkout 已安装依赖并生成 `lib` 产物。本次验证使用 Node 24.14.1、Cordis 4.0.5、TypeScript 6.0.3、tsdown 0.22.2。

在插件目录执行：

```bash
node scripts/use-local-dsh.mjs "/path/to/deepseek-harness"
npm run typecheck:source
npm run build
npm test
```

`use:local` 只在本插件 `node_modules` 创建链接，并保存忽略提交的 `.dsh/local.json`，不会写入 DSH 源码或安装 profile。已有同名依赖指向不同位置时拒绝覆盖。也可通过 `DSH_ROOT` 指定 checkout。

Host 和 Client 分开检查，避免 Cordis Context 声明混入同一类型程序。`typecheck:source` 按 DSH 源码路径解析接口并检查插件自身诊断，DSH 和 vendor 内部实现仍由各自的 TypeScript 项目负责。

产物为 `index.mjs`、`client.js`、`client.js.map`。Host 的 DSH 运行时依赖保持外部引用；Browser 的 React、Cordis、store 从 DSH 共享模块表获取。构建通过 Node 执行工具入口，支持 Windows。

## 本地安装

构建完成后，在 DSH checkout 中执行：

```bash
node --import tsx/esm apps/cli/src/bin.ts plugin --profile web add -w '"link:/path/to/dsh-message-edit"'
```

该命令会修改 web profile 插件配置；重启 DSH 后加载。后续源码修改需要重新构建并重启。仓库保留 `cordis.patch.yml`，浏览器依赖由 package manifest 声明。

也可以从 GitHub 安装本仓库的构建产物：

```bash
dsh plugin --profile web add github:RedContritio/dsh-message-edit
```

仓库提交了 `index.mjs` / `client.js` / `client.js.map`，因此 Git 安装不需要执行构建脚本。

## 分支与持久化

完整回合是编辑边界。用户编辑、retry 和 reroll 从目标回合开始之前分支，再排入用户输入。助手编辑从同一边界构造闭合手工回合，只包含原用户输入和选中助手消息的文本/思考；原工具链不进入新分支。

当前 DSH v4 要求新建 Session 的 constructor seed 完全等于继承前缀，Agent 构造时又会初始化回合计数。因此不能把自有编辑事件塞入 `agents.create()` seed，也不能在 Agent 构造后追加手工回合再直接继续生成。

本版本通过公开接口分阶段完成操作：

1. 在来源 Agent 的 `runMaintenance()` 内取得闭合历史前缀，先解析 preset。
2. 用脱离 live registry 的 `Session.create()` 设置 `isSeeded`、`inheritedEventCount`，由 DSH 生成继承边界标记。
3. 添加 `ignorable` 的 `plugin:message-edit/version` 记录和可选手工回合，使用 `Session.fromRestore()` 校验完整日志。
4. persistence 写 handle 执行 create、append、flush、close。
5. `agents.resume()` 从完整日志恢复 Agent，在发布前的 `setup` 中通过 `agent.inbox.clear()` 清除截断历史留下的待处理输入，再挂载 preset。DSH 会持久化清除记录；发布后挂接 workspace 并排入操作计划中的用户输入。

输入入队可能早于 `turn/start`，消费记录却位于回合内部。只截断回合会使已消费的原请求重新变成待处理项，因此新分支必须重建待处理队列。

手工助手回合的 `request/header` 位于其已打开的 step 内，保证第一回合手工编辑 cold resume 时仍有模型路由；用户编辑、retry 和 reroll 不预置请求头，由后续 Agent 回合自行生成。

DSH 没有公开的持久化分支删除接口。保存阶段失败会报告分支 ID，需要检查持久化状态；完整保存后 Agent 恢复失败，闭合分支仍保留，错误中提供可恢复 ID。workspace 挂接失败会释放取得的 Agent handle，但不会删除已保存历史。插件不承诺跨持久化和 Agent 生命周期的原子回滚。

历史读取使用 `snapshotEvents()`、`ownEvents()`、query 和 persistence 只读 handle。继承边界随对应 live Session 或 handle 的日志一起取得；所有只读 handle 在 finally 关闭。

## 版本数据

每个版本自有后缀包含一个 v4 插件记录 `plugin:message-edit/version`，数据结构为：

```ts
{
  schemaVersion: 2,
  effect: { id, operation, cascade, targetTurn, targetEventSeq,
            targetBlockIndex?, blockKind?, before?, after? },
  inverse: { kind: 'restore-version', sessionId }
}
```

该记录通过 `PluginRecordMap` 声明并带 `ignorable: true`：版本导航元数据不改变模型历史，DSH 的已知事件表也不会通过第三方声明合并扩充。缺少此标记会导致冷读拒绝。`inverse.sessionId` 必须等于 header 的 `parentSession`，自有记录按 `inheritedEventCount` 筛选，祖先记录不会重复算作本版本效果。

仍识别旧平面版本 payload；旧 DSH 物理格式是否可读取由 DSH 自身迁移器负责。

## HTTP 与 UI

- `GET /api/message-edit?sessionId=<id>`：消息、可重试回合和版本树。
- `POST /api/message-edit`：执行 edit、reroll 或 retry，返回新 Session ID。
- 路由通过 `ctx.connection.fetch.register()` 注册，经过 DSH 认证、来源检查和请求体大小限制。
- Client 使用 `dsh-api-session-controller` 会话与事件源、`dsh-client-store` 状态容器；闭合回合、历史窗口替换、版本谱系变化会触发刷新。
- Timeline 注册为 `conversation.view`，order 15；标题栏为 `conversation.session.header.actions`。

行内按钮依赖当前 Chat DOM 的节点标识和 actions 容器，需随 DSH UI 变动维护。测试覆盖浏览器 bundle、重复文本、跨面板隔离、刷新及卸载。

## 验证范围

`npm test` 覆盖真实 Session 校验、JSONL 保存与冷读、多层继承、恢复失败、非法输入。生产 AgentLoop 测试通过真实 `followup` 生成来源回合，连续编辑思考和正文，再关闭并恢复分支，验证“继续”的模型请求包含两项修改且原输入不重复；另外验证用户编辑、retry、reroll 不重复排队。模型使用测试适配器，不调用真实模型，不读写用户已有会话。

历史保持 append-only；编辑不会撤销工作区文件、终端命令及其他外部副作用。

## 许可与来源

上游项目声明 MIT License。本仓库保留上游 git 历史，并在 `LICENSE` 中同时保留上游与二次开发者的版权声明。二次开发部分相对上游的改动集中在 DSH 0.2.x / Session v4 兼容、认证路由、分支冷恢复与测试。
