# zcode-plugin-git

ZCode 插件：Git 工作台侧栏面板（MCP Apps）+ AI 生成提交信息。

## 功能

- **侧栏 Git 面板**（右侧栏，MCP Apps 标准）：查看分支、暂存区/工作区修改列表（含重命名、冲突、未跟踪）、点击展开彩色 diff
- **文件操作**：添加到暂存（git add）、取消暂存还原到工作区（git restore --staged）、撤销工作区修改（git restore / 删除未跟踪文件，危险操作需二次确认）
- **AI 生成提交信息**：面板「✨ AI 生成」按钮走宿主模型采样（`sampling/createMessage`），基于暂存 diff 生成 Conventional Commits 风格信息；聊天里也可用 `/git:commit` 斜杠命令由模型生成并提交
- **提交**：提交框内 Ctrl+Enter 或「提交」按钮，一键提交暂存区

## 目录

```
plugins/
  marketplace.json          本地测试市场清单（dev-zcode-plugin-git-e73aa4b8）
  git/
    .zcode-plugin/plugin.json   插件 manifest（ui.surfaces 声明侧栏面板）
    commands/commit.md          /git:commit 斜杠命令
    server/server.mjs           MCP server 源码（7 个 git 工具 + 面板资源服务）
    ui/src/main.js              面板源码（vanilla JS + @modelcontextprotocol/ext-apps）
    ui/src/panel.css            面板样式（宿主主题变量 + 回退）
    dist/server.mjs             打包产物（esbuild，零运行时依赖）
    dist/ui/panel.html          打包产物（内联全部 JS/CSS）
scripts/
  build.mjs                 打包：node scripts/build.mjs
  smoke.mjs                 MCP 协议冒烟测试（临时 git 仓库，28 项断言）
  serve-panel.mjs           面板 UI 测试床静态服务
  mock-host.html            Mock ZCode 宿主（ui/initialize + 工具/采样桩）
```

## 开发

```bash
npm install          # 安装 esbuild / MCP SDK（仅构建期）
npm run build        # 重新打包 server + panel
npm run smoke        # 冒烟测试（需本机 git）
node scripts/serve-panel.mjs   # 浏览器打开 http://127.0.0.1:8137/mock 实测面板 UI
```

改动源码后 `npm run build`，然后在 ZCode 里刷新市场并更新插件（源码不会热加载）。

## 工具清单（MCP）

| 工具 | 说明 |
| --- | --- |
| `git_status` | 分支、ahead/behind、暂存/工作区/冲突文件列表 |
| `git_diff` | 单文件 diff（staged=true 为暂存区 vs HEAD；未跟踪文件合成全新增 diff） |
| `git_stage` | git add |
| `git_unstage` | git restore --staged（首次提交前等价 git rm --cached） |
| `git_discard` | 撤销工作区修改 / 删除未跟踪文件（危险） |
| `git_commit` | 提交暂存区（-F - 读 stdin，UTF-8 多行信息） |
| `git_log` | 最近提交历史 |
