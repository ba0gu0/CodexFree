# ADR 0001：技术栈

## 状态

已接受。

## 背景

CodexFree 是一个本地桌面 app 加代理服务。它需要管理 UI、本地 HTTPS server、
SQLite 持久化、账号导入/导出流程、请求历史和额度分析。

## 决策

使用：

- Medium 项目规模。
- Bun 用于运行时脚本和 package 执行。
- Strict TypeScript。
- Electron with Vite。
- React 19。
- Tailwind CSS。
- Coss UI 作为 shadcn-style 组件来源。
- 通过 Coss UI 使用 Base UI primitives。
- `lucide-react` 用于图标。
- SQLite with Drizzle ORM。
- Vitest 优先，之后为 UI 和 Electron 流程补充 Playwright。
- Electron main process 启动本地 Node HTTPS proxy server。

独立 task card 未启用。`docs/next-tasks.md` 仍然是任务队列权威来源。

## 影响

- Radix UI 不是默认 primitive 层。
- Coss UI 设置应使用 `bunx shadcn@latest` 命令，而不是 pnpm。
- Drizzle migrations 应随 project manifest 引入。
- Proxy core 应保持隔离，以便需要时可以移动到 sidecar。
