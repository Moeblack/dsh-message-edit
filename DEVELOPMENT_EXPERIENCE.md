# DSH 本地插件开发经验

## 本地开发与打包

- 源码修改后先执行 `npm test`（项目有测试时）和 `npm run build`。
- 用 `npm pack --dry-run` 检查发布内容，再执行 `npm pack` 生成 `.tgz`。
- 本地包不需要 npm 登录或 `npm publish`，也不会打包 `node_modules`；运行依赖由 DSH profile 的 pnpm 安装。
- Windows 构建脚本不要直接 `spawn node_modules/.bin/*.cmd`；直接用 `process.execPath` 执行依赖的实际 JS 入口更可靠。

## 安装到 DSH

```powershell
dsh plugin --profile web add "D:\path\to\dsh-message-edit-0.2.3.tgz"
```

也可以显式使用 `file:`：

```powershell
dsh plugin --profile web add "file:D:\path\to\dsh-message-edit-0.2.3.tgz"
```

- DSH CLI 可能不在当前 PowerShell 的 `PATH`；实际安装位置通常是 `$DSH_HOME\profiles\node_modules\@deepseek-ai\dsh\lib\bin.js`，可用 `node <bin.js> plugin ...` 执行。
- DSH profile 的 pnpm 可能因为 lockfile 中其他近期发布的依赖触发 `minimumReleaseAge`，即使安装源是本地包也会失败。获得授权后，只对本次命令临时增加 `--config.minimumReleaseAge=0`，不要修改全局或持久化策略。
- 同版本 tarball 可能被缓存；代码变更后递增版本号再重新 `npm pack` 和安装。
- 安装不要求先停止 DSH，但运行中的 DSH 不会热加载新插件，安装后需要重启才能看到新代码。

## 重要构建陷阱

- Host 插件中尽量只使用 DSH 包的 `import type`。新增运行时导入可能让 tsdown 把 `@deepseek-ai/dsh-*` 依赖内联进 `index.mjs`。
- 构建日志出现 `Detected dependencies in bundle` 时要检查是否把 DSH 运行时依赖打进去了。
- 错误 `Cannot find module '../package.json'` 且堆栈指向插件的 `index.mjs`，通常是被内联依赖中的相对路径失效。根本修复是移除不必要的运行时导入或正确配置外部依赖，不要在包里伪造路径文件。
- 打包后至少执行 `node --check index.mjs`、`node --check client.js`，并从 DSH profile 的实际安装路径直接 `import` Host 模块验证加载。

## 本次功能的实现原则

- `保存` 只写入当前会话的浏览器草稿缓存，不创建 fork。
- `保存并重新生成` 一次性提交同一回合的全部草稿，只创建一个 fork。
- `删除` 暂存整条用户或助手消息删除；提交后移除真实消息事件，不能改成空文本占位。
