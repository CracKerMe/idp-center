# Implementation Plan: GitHub OAuth Integration

## Overview

基于现有 `server.ts` 单文件架构扩展 GitHub OAuth 2.0 授权码流程，包括数据库迁移、后端路由、账户关联逻辑、前端改造及测试。

## Tasks

- [x] 1. 数据库迁移：新增 linked_accounts 和 oauth_states 表
  - 在 `server.ts` 的 `db.exec()` 初始化块中追加两张表的 `CREATE TABLE IF NOT EXISTS` 语句
  - `linked_accounts` 表包含 `id`、`user_id`、`provider`、`provider_user_id`、`provider_username`、`access_token`、`created_at`、`updated_at` 字段，并在 `(provider, provider_user_id)` 上建唯一索引
  - `oauth_states` 表包含 `state`（主键）、`expires_at`、`created_at` 字段
  - _Requirements: 6.1, 6.2, 6.3, 6.4_

  - [ ]* 1.1 为数据库表结构编写单元测试
    - 验证 `linked_accounts` 和 `oauth_states` 表的字段和唯一索引存在
    - 使用内存 SQLite (`:memory:`) 保证测试隔离
    - _Requirements: 6.1, 6.2, 6.4_

- [x] 2. 定义 TypeScript 接口与辅助函数
  - 在 `server.ts` 中新增 `GitHubIdentity` 和 `LinkedAccount` 接口
  - 实现 access token 加密/解密辅助函数（AES-256-GCM），密钥优先读取 `ENCRYPTION_KEY`，降级使用 `JWT_SECRET` 的 SHA-256 派生值
  - 实现 `generateOAuthState()` 函数：使用 `crypto.randomBytes(32).toString('hex')` 生成 state
  - _Requirements: 1.1, 1.2, 7.1_

  - [ ]* 2.1 为 state 生成编写属性测试
    - **Property 1: State 唯一性**
    - **Validates: Requirements 2.2, 7.1**
    - 验证批量生成的 state 值唯一且长度为 64 个十六进制字符

- [x] 3. 实现 `/api/auth/github/config` 端点
  - 在 `server.ts` 中新增 `GET /api/auth/github/config` 路由
  - 返回 `{ enabled: boolean }`，当 `GITHUB_CLIENT_ID` 和 `GITHUB_CLIENT_SECRET` 均已配置时为 `true`
  - 不暴露任何密钥信息
  - _Requirements: 1.5, 9.4_

  - [ ]* 3.1 为配置端点编写单元测试
    - 测试未配置时返回 `{ enabled: false }`
    - 测试已配置时返回 `{ enabled: true }`
    - _Requirements: 1.4, 9.4_

- [x] 4. 实现 `/api/auth/github` 授权发起端点
  - 在 `server.ts` 中新增 `GET /api/auth/github` 路由
  - 检查 `GITHUB_CLIENT_ID` / `GITHUB_CLIENT_SECRET`，未配置时返回 HTTP 503 及 `{ error: "GitHub OAuth is not configured", code: "GITHUB_NOT_CONFIGURED" }`
  - 调用 `generateOAuthState()` 生成 state，写入 `oauth_states` 表并设置 10 分钟过期时间
  - 构造 GitHub 授权 URL（包含 `client_id`、`redirect_uri`、`scope=read:user user:email`、`state`），302 重定向用户
  - _Requirements: 1.3, 1.4, 2.2, 2.3, 2.4, 2.5_

  - [ ]* 4.1 为授权 URL 构造编写属性测试
    - **Property 2: 授权 URL 完整性**
    - **Validates: Requirements 2.4, 2.5**
    - 验证任意合法配置下生成的 URL 均包含 `client_id`、`redirect_uri`、`scope`、`state` 四个参数，且 scope 包含 `read:user` 和 `user:email`

  - [ ]* 4.2 为配置缺失场景编写单元测试
    - 验证未配置时返回 HTTP 503
    - _Requirements: 1.4_

- [x] 5. 实现 GitHub OAuth Provider 函数
  - 在 `server.ts` 中实现 `exchangeGitHubCode(code: string): Promise<string>`，向 `https://github.com/login/oauth/access_token` 换取 access token
  - 实现 `getGitHubUser(accessToken: string): Promise<GitHubIdentity>`，调用 `https://api.github.com/user`
  - 实现 `getGitHubEmails(accessToken: string): Promise<string | null>`，调用 `https://api.github.com/user/emails`，取 primary + verified 的邮箱
  - _Requirements: 3.3, 3.5_

- [x] 6. 实现 Account Linker 函数
  - 在 `server.ts` 中实现 `findOrCreateUserFromGitHub(identity: GitHubIdentity): User`
  - 优先级：① 按 `provider_user_id` 查 `linked_accounts` → ② 按邮箱匹配 `users` 表并创建关联 → ③ 创建新用户（用户名冲突时追加 4 位随机十六进制后缀）+ 新 `linked_accounts` 记录
  - 新用户的 `password_hash` 设置为不可登录的占位值（空字符串的 bcrypt 哈希）
  - 创建/更新 `linked_accounts` 时记录 `provider_user_id`、`provider_username`、加密后的 `access_token`、`created_at`、`updated_at`
  - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6_

  - [ ]* 6.1 为已关联账户直接登录编写属性测试
    - **Property 6: 已关联账户直接登录**
    - **Validates: Requirements 4.1, 4.2**
    - 验证 `provider_user_id` 已存在时不创建新用户和新 linked_account

  - [ ]* 6.2 为邮箱匹配自动关联编写属性测试
    - **Property 7: 邮箱匹配自动关联**
    - **Validates: Requirements 4.3**
    - 验证无 linked_account 但邮箱匹配时，创建关联记录并返回已有用户

  - [ ]* 6.3 为未知身份自动创建账户编写属性测试
    - **Property 8: 未知身份自动创建账户**
    - **Validates: Requirements 4.4**
    - 验证无匹配时用户总数恰好增加 1

  - [ ]* 6.4 为 GitHub 创建账户无法密码登录编写属性测试
    - **Property 9: GitHub 创建的账户无法密码登录**
    - **Validates: Requirements 4.5**
    - 验证任意密码字符串与占位 `password_hash` 的 `bcrypt.compare` 均返回 false

  - [ ]* 6.5 为 linked_account 记录完整性编写属性测试
    - **Property 10: Linked Account 记录完整性**
    - **Validates: Requirements 4.6, 6.1, 6.2**
    - 验证创建/更新的记录中 `provider_user_id`、`provider_username`、`access_token`、`created_at`、`updated_at` 均非 null

- [x] 7. 实现 `/api/auth/github/callback` 回调处理端点
  - 在 `server.ts` 中新增 `GET /api/auth/github/callback` 路由
  - 处理 GitHub 错误响应（`error=access_denied` 等），重定向至 `/login?error=<可读描述>`
  - 验证 `state` 参数（查 `oauth_states` 表，检查 `expires_at`），验证后立即删除该记录；不匹配或已过期时返回 HTTP 400 `{ "error": "Invalid or expired OAuth state" }`
  - 调用 `exchangeGitHubCode` 换取 access token，失败时重定向至登录页并写入 `GITHUB_LOGIN_FAILED` 审计日志
  - 调用 `getGitHubUser` + `getGitHubEmails` 获取用户信息，失败时重定向至登录页并写入审计日志
  - 调用 `findOrCreateUserFromGitHub` 完成账户关联/创建
  - 生成 JWT access token 和 refresh token（格式与密码登录一致），在 `sessions` 表创建会话记录
  - 写入 `GITHUB_LOGIN_SUCCESS` 审计日志（含用户 ID 和 GitHub 用户名）
  - 302 重定向至 `/?access_token=...&refresh_token=...`
  - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 5.1, 5.2, 5.3, 5.4, 7.2, 7.3, 7.4, 9.1, 9.2_

  - [ ]* 7.1 为有效 state 被接受编写属性测试
    - **Property 3: 有效 State 被接受**
    - **Validates: Requirements 2.3, 3.1**
    - 验证在 10 分钟过期窗口内生成并存储的 state 被回调处理器接受

  - [ ]* 7.2 为无效或过期 state 被拒绝编写属性测试
    - **Property 4: 无效或过期 State 被拒绝**
    - **Validates: Requirements 3.2**
    - 验证不存在或已过期的 state 返回 HTTP 400 及正确错误信息

  - [ ]* 7.3 为 state 单次使用编写属性测试
    - **Property 5: State 单次使用（防重放）**
    - **Validates: Requirements 3.7, 7.2**
    - 验证已消费的 state 再次使用时被拒绝

  - [ ]* 7.4 为令牌格式一致性编写属性测试
    - **Property 11: 令牌格式与密码登录一致**
    - **Validates: Requirements 5.1**
    - 验证成功登录响应结构包含 `access_token`、`refresh_token`、`expires_in`、`token_type`、`user`

  - [ ]* 7.5 为成功登录创建会话记录编写属性测试
    - **Property 12: 成功登录创建会话记录**
    - **Validates: Requirements 5.2**
    - 验证回调完成后 `sessions` 表中存在对应用户的记录

  - [ ]* 7.6 为令牌通过重定向 URL 传递编写属性测试
    - **Property 13: 令牌通过重定向 URL 传递**
    - **Validates: Requirements 5.3**
    - 验证重定向 URL 包含 `access_token` 和 `refresh_token` 参数

  - [ ]* 7.7 为成功登录审计日志编写属性测试
    - **Property 14: 成功登录审计日志**
    - **Validates: Requirements 5.4**
    - 验证 `audit_logs` 中存在 `GITHUB_LOGIN_SUCCESS` 记录，含用户 ID 和 GitHub 用户名

  - [ ]* 7.8 为失败流程审计日志编写属性测试
    - **Property 15: 失败流程审计日志**
    - **Validates: Requirements 7.4**
    - 验证任意错误路径均写入 `GITHUB_LOGIN_FAILED` 审计日志

  - [ ]* 7.9 为 GitHub 错误响应重定向编写单元测试
    - **Property 18: GitHub 错误响应重定向至登录页**
    - **Validates: Requirements 9.1, 9.2**
    - 验证 `error=access_denied` 及其他 OAuth 错误码均重定向至登录页并附带可读错误描述

- [x] 8. 检查点 — 确保所有后端测试通过
  - 确保所有测试通过，如有疑问请向用户确认。

- [x] 9. 实现 `/api/user/linked-accounts` 端点
  - 在 `server.ts` 中新增 `GET /api/user/linked-accounts` 路由，要求有效 JWT 认证（复用现有 auth 中间件）
  - 查询当前用户的 `linked_accounts` 记录，返回 `provider`、`provider_username`、`created_at`，不返回 `access_token`
  - _Requirements: 8.1, 8.2, 8.3_

  - [ ]* 9.1 为已关联账户列表字段正确性编写属性测试
    - **Property 16: 已关联账户列表字段正确性**
    - **Validates: Requirements 8.1, 8.2**
    - 验证响应包含 `provider`、`provider_username`、`created_at`，且不含 `access_token`

  - [ ]* 9.2 为端点认证要求编写属性测试
    - **Property 17: 已关联账户端点需要认证**
    - **Validates: Requirements 8.3**
    - 验证无有效 JWT 时返回 HTTP 401

- [x] 10. 改造 Login.tsx 前端页面
  - 在 `Login.tsx` 中调用 `/api/auth/github/config` 端点，根据 `enabled` 字段决定是否渲染"使用 GitHub 登录"按钮（`enabled=false` 时隐藏或禁用）
  - 点击按钮时跳转至 `/api/auth/github`（`window.location.href` 或 `<a>` 标签）
  - 读取 URL 参数中的 `access_token` / `refresh_token`，存入本地存储并完成登录（复用现有密码登录后的处理逻辑）
  - 读取 URL 参数中的 `error` 字段并在页面上展示对应错误提示信息
  - _Requirements: 2.1, 5.3, 9.3, 9.4_

  - [ ]* 10.1 为登录页错误展示编写单元测试
    - 验证 URL 含 `error` 参数时展示错误信息
    - 验证 `enabled=false` 时隐藏 GitHub 登录按钮
    - _Requirements: 9.3, 9.4_

- [x] 11. 实现过期 state 清理机制
  - 在 `server.ts` 中添加定期清理逻辑（如在每次 `/api/auth/github` 请求时顺带清理，或使用 `setInterval`），删除 `oauth_states` 表中 `expires_at < CURRENT_TIMESTAMP` 的记录
  - _Requirements: 7.5_

- [x] 12. 最终检查点 — 确保所有测试通过
  - 运行完整测试套件（`vitest --run`），确保所有测试通过，如有疑问请向用户确认。

## Notes

- 标有 `*` 的子任务为可选项，可跳过以加快 MVP 进度
- 每个任务均引用具体需求条款以保证可追溯性
- 属性测试文件：`tests/github-oauth.property.test.ts`，单元测试文件：`tests/github-oauth.unit.test.ts`
- 所有属性测试使用 `fast-check`，每个属性对应一个独立子任务，注释格式：`// Feature: github-oauth, Property {N}: {property_text}`
- GitHub API 调用使用 `vi.mock` 隔离，数据库测试使用内存 SQLite (`:memory:`)
