# 认证文件管理规格

## 状态

进行中。

Codex 原生认证文件和平铺的 Codex/CPA 兼容 token 记录，已由第一个纯规范化模块覆盖。sub2api 解析在提供真实样例文件前仍保持草稿状态。

## 支持的格式

- Codex 已认证的 `auth.json`。
- CPA 格式认证文件。
- sub2api 格式认证文件。

parser 可以标记为 Ready 前，仍然需要样例文件。

当前 parser 覆盖范围：

- 原生 Codex `auth.json`，包含 `auth_mode = "chatgpt"` 和嵌套 `tokens`；
- 平铺 token 记录，包含 `id_token`、`access_token`、`refresh_token`、`account_id` 和 `last_refresh`；
- 通过 `type = "cpa"` 声明，或从文件名推断的 CPA 记录。

sub2api 记录只有在暴露与平铺 Codex 形态相同的必需 token 字段时才会被接受。

## 规范化形态

normalizer 返回：

- 安全元数据：format、label、account id、可选 email、disabled 状态、可选 expiry、last refresh 时间戳、稳定 fingerprint 和 warnings；
- 用于后续安全存储或导出的标准 Codex account-login auth 形态。

fingerprint 从 account id 加 token 值派生，这样可以检测重复文件而不显示原始密钥。

## 导入

批量导入必须：

- 检测格式；
- 规范化账号元数据；
- 验证必需字段且不记录密钥；
- 尽可能使用稳定标识符对账号去重；
- 对不支持或格式错误的文件标记可执行的错误。

Parser 错误必须指出缺失或无效字段名，但不得包含 token 值。

## 导出

批量导出必须支持：

- Codex `auth.json` 格式；
- CPA 格式；
- sub2api 格式。

除非用户明确选择 disabled accounts，否则导出不得包含它们。

## 用量查询

UI 应支持对选中账号进行批量额度或用量查询，并将结果连同时间戳、状态和错误原因存储到 SQLite。
