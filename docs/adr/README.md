# 架构决策记录

ADR 状态值包括 Proposed、Accepted、Deprecated 和 Superseded。

## 已接受

- `0001-technical-stack.md` - Electron、Bun、React 19、Coss UI、SQLite 和
  Drizzle ORM。

## 规则

- 技术栈变更、代理协议变更、认证存储变更和数据库 schema 策略变更，都要创建 ADR。
- 不要静默修改已接受的 ADR。新增一个取代它的 ADR。
- 当 ADR 改变实施方向时，更新 `docs/current-state.md` 和 `docs/next-tasks.md`。
