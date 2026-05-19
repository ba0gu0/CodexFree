# 项目审计

## 初始化事实

- 日期：2026-05-12
- 根目录：`/Users/<user>/Documents/Projict/node/CodexFree`
- 初始状态：空目录，未检测到 git 仓库。
- 选择的预设：Medium。
- 原因：桌面 app 加本地代理服务、管理 UI、数据库、导入和导出流程、用量分析，以及安全敏感的认证切换。

## 生成的文件

- `AGENTS.md`
- `docs/current-state.md`
- `docs/next-tasks.md`
- `docs/architecture.md`
- `docs/definition-of-done.md`
- `docs/security-checklist.md`
- `docs/project-audit.md`
- `docs/adr/README.md`
- `docs/adr/0001-technical-stack.md`
- `docs/specs/proxy-service.md`
- `docs/specs/auth-file-management.md`
- `docs/specs/desktop-ui.md`
- Electron/Vite 源码、package manifest、Biome、Paraglide、Drizzle 和 renderer 初始化文件。

## 从用户请求中确认

- Electron app 是预期的外壳。
- `openai_base_url` 使用的本地代理端点是
  `http://127.0.0.1:33333/backend-api/codex`，`chatgpt_base_url` 使用的是
  `http://127.0.0.1:33333/backend-api`。
- 本地 placeholder `~/.codex/auth.json` 是随机生成的，代理不会验证它。
- 代理只改写认证 header。
- 用户会提供 Yakit 包导出用于兼容性分析。
- SQLite 应记录请求历史，并支持账号和用量分析。
- 已确认技术栈：Medium、Bun、strict TypeScript、Electron with Vite、React 19、Tailwind CSS、Coss UI、Base UI、`lucide-react`、SQLite with Drizzle ORM、Vitest。
- ADR 已启用。
- 独立 task card 未启用。
- 初始化验证已通过 lint、typecheck、Vitest、build、unpack packaging、dev UI 和 unpacked app UI。
- Electron updater 已启用。GitHub owner/repo 初始化为 `ba0gu0/CodexFree`。

## 待确认

- 是否应启用 handoff report。
- 用于更新发布的最终 GitHub repository owner/name 仍需在配置发布前确认；初始化值为
  `ba0gu0/CodexFree`。
- 打包、证书和 notarization 要求。
