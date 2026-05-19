# 完成定义

## 通用

一个任务只有在以下全部条件满足时才算完成：

- 行为已经实现，或文档产物已经完成。
- 验证证据已经记录在 `docs/next-tasks.md` 中。
- 如果项目状态发生变化，`docs/current-state.md` 已经更新。
- 没有提交认证密钥、原始 token、cookie 或敏感 header。
- 面向用户的行为与 `docs/specs/` 下的相关规格一致。

## 代理任务

代理相关任务必须验证：

- API-key 模式请求会被拒绝。
- 账号模式请求 body 不会被改写。
- 只修改上游认证相关 header。
- 流式响应仍然与 Codex 兼容。
- 额度耗尽的账号会从后续选择中移除。
- 运行中的请求在到达运行边界前保持已绑定的认证。

## UI 任务

UI 相关任务必须验证：

- 批量导入和导出状态可见。
- 账号状态、额度状态和当前代理状态可以区分。
- 面向用户的文本为 i18n 做好准备，而不是内联硬编码字符串。
- 密钥默认被遮蔽。
- 错误状态说明需要采取什么操作，同时不暴露 token。

## 数据任务

SQLite 相关任务必须验证：

- schema migration 是显式的，并且在开发阶段可回滚。
- 请求记录能关联到账号记录，但不存储原始密钥值。
- 保留和清理行为已经文档化。
- 批量操作可以通过审计事件追踪。

## 当前命令

按触及范围运行适用的命令：

```bash
bun run lint
bun run typecheck
bun run test
bun run build
bun run build:unpack
```

对于 UI 变更，还要用 Computer Use 验证开发窗口和 unpacked app。
`build:unpack` 会有意通过 `-c.mac.identity=null` 跳过 macOS 签名，所以本地
打包速度更快，并生成可运行的 app。需要签名的 macOS 产物时使用
`bun run build:mac`。
