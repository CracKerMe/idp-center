# Requirements Document

## Introduction

本功能为现有认证服务（IdP Center）增加 GitHub OAuth Apps 作为第三方身份提供商的支持。用户可以通过 GitHub 账号登录或将 GitHub 账号绑定到现有账户，无需单独注册。系统需要在现有 OAuth 2.0 基础设施之上，实现与 GitHub OAuth Apps 的完整集成，包括授权流程、回调处理、用户信息获取、账户关联以及安全审计。

## Glossary

- **GitHub_OAuth_Provider**: 负责与 GitHub OAuth Apps API 交互的服务端模块
- **GitHub_Callback_Handler**: 处理 GitHub OAuth 授权回调的服务端路由处理器
- **Account_Linker**: 负责将 GitHub 身份与本地用户账户关联或创建新账户的模块
- **OAuth_State_Store**: 存储和验证 OAuth state 参数以防止 CSRF 攻击的机制
- **GitHub_Identity**: 从 GitHub API 获取的用户身份信息（GitHub 用户 ID、用户名、邮箱、头像）
- **Linked_Account**: 本地用户账户与 GitHub 身份之间的关联记录
- **Login_Page**: 现有的用户登录页面（Login.tsx）
- **Auth_Service**: 现有的认证服务后端（server.ts）
- **IdP_Center**: 本认证服务系统的整体名称


## Requirements

### Requirement 1: GitHub OAuth 配置

**User Story:** 作为系统管理员，我希望通过环境变量配置 GitHub OAuth App 凭据，以便安全地管理 GitHub 集成所需的密钥。

#### Acceptance Criteria

1. THE Auth_Service SHALL 从环境变量 `GITHUB_CLIENT_ID` 读取 GitHub OAuth App 的 Client ID
2. THE Auth_Service SHALL 从环境变量 `GITHUB_CLIENT_SECRET` 读取 GitHub OAuth App 的 Client Secret
3. THE Auth_Service SHALL 从环境变量 `GITHUB_CALLBACK_URL` 读取 OAuth 回调地址，默认值为 `http://localhost:5986/api/auth/github/callback`
4. IF `GITHUB_CLIENT_ID` 或 `GITHUB_CLIENT_SECRET` 未配置，THEN THE Auth_Service SHALL 在 GitHub 登录端点返回 HTTP 503 状态码及描述性错误信息
5. THE Auth_Service SHALL 将 GitHub OAuth 凭据仅存储于服务端，不暴露给前端客户端

---

### Requirement 2: GitHub OAuth 授权发起

**User Story:** 作为用户，我希望在登录页面点击"使用 GitHub 登录"按钮，以便通过 GitHub 账号快速登录系统。

#### Acceptance Criteria

1. THE Login_Page SHALL 展示"使用 GitHub 登录"按钮
2. WHEN 用户点击"使用 GitHub 登录"按钮，THE Auth_Service SHALL 生成一个不可预测的随机 state 参数（至少 16 字节随机值）
3. WHEN state 参数生成后，THE OAuth_State_Store SHALL 将 state 值存储并设置 10 分钟过期时间
4. WHEN state 参数生成后，THE Auth_Service SHALL 将用户重定向至 GitHub 授权页面，URL 包含 `client_id`、`redirect_uri`、`scope` 和 `state` 参数
5. THE Auth_Service SHALL 请求的 GitHub OAuth scope 至少包含 `read:user` 和 `user:email`


---

### Requirement 3: GitHub OAuth 回调处理

**User Story:** 作为用户，我希望在 GitHub 授权后被自动重定向回系统并完成登录，以便无缝完成认证流程。

#### Acceptance Criteria

1. WHEN GitHub 将用户重定向至回调地址并携带 `code` 和 `state` 参数，THE GitHub_Callback_Handler SHALL 验证 `state` 参数与 OAuth_State_Store 中存储的值一致
2. IF `state` 参数不匹配或已过期，THEN THE GitHub_Callback_Handler SHALL 拒绝请求并返回 HTTP 400 状态码及错误信息 "Invalid or expired OAuth state"
3. WHEN state 验证通过，THE GitHub_OAuth_Provider SHALL 使用 `code` 向 GitHub token 端点（`https://github.com/login/oauth/access_token`）换取 GitHub access token
4. IF GitHub token 换取失败，THEN THE GitHub_Callback_Handler SHALL 将用户重定向至登录页面并附带错误提示参数
5. WHEN GitHub access token 获取成功，THE GitHub_OAuth_Provider SHALL 使用该 token 调用 GitHub API（`https://api.github.com/user` 和 `https://api.github.com/user/emails`）获取用户信息
6. IF GitHub API 调用失败，THEN THE GitHub_Callback_Handler SHALL 将用户重定向至登录页面并附带错误提示参数
7. WHEN 回调处理完成，THE OAuth_State_Store SHALL 使已使用的 state 值失效，防止重放攻击

---

### Requirement 4: 账户关联与自动注册

**User Story:** 作为用户，我希望系统能自动将我的 GitHub 账号与现有本地账户关联，或在首次登录时自动创建账户，以便减少手动操作。

#### Acceptance Criteria

1. WHEN GitHub 身份信息获取成功，THE Account_Linker SHALL 在 `linked_accounts` 表中查询是否存在与该 GitHub 用户 ID 关联的本地账户
2. IF 存在与 GitHub 用户 ID 匹配的 Linked_Account，THEN THE Account_Linker SHALL 使用关联的本地用户账户完成登录
3. IF 不存在 Linked_Account 但 GitHub 返回的邮箱与某本地账户邮箱匹配，THEN THE Account_Linker SHALL 将该 GitHub 身份与现有本地账户关联，并完成登录
4. IF 既无 Linked_Account 也无邮箱匹配的本地账户，THEN THE Account_Linker SHALL 自动创建新的本地用户账户，用户名取自 GitHub 用户名（若冲突则追加随机后缀），并创建 Linked_Account 记录
5. WHEN 新账户通过 GitHub OAuth 创建时，THE Account_Linker SHALL 将该账户的 `password_hash` 设置为不可登录的占位值（如空字符串的 bcrypt 哈希），确保账户无法通过密码直接登录
6. THE Account_Linker SHALL 在创建或更新 Linked_Account 时记录 GitHub 用户 ID、GitHub 用户名、access token（加密存储）及关联时间


---

### Requirement 5: 登录会话颁发

**User Story:** 作为用户，我希望通过 GitHub OAuth 登录后获得与密码登录相同的会话令牌，以便无缝使用系统所有功能。

#### Acceptance Criteria

1. WHEN GitHub OAuth 登录成功，THE Auth_Service SHALL 生成 JWT access token 和 refresh token，格式与密码登录返回的令牌完全一致
2. WHEN GitHub OAuth 登录成功，THE Auth_Service SHALL 在 `sessions` 表中创建会话记录
3. WHEN GitHub OAuth 登录成功，THE Auth_Service SHALL 将用户重定向至前端，并通过 URL 参数或安全方式传递 access token 和 refresh token
4. THE Auth_Service SHALL 在 GitHub OAuth 登录的审计日志中记录 `GITHUB_LOGIN_SUCCESS` 事件，包含用户 ID 和 GitHub 用户名

---

### Requirement 6: 数据库结构扩展

**User Story:** 作为系统，我需要持久化存储 GitHub 账户关联信息，以便在后续登录时识别用户身份。

#### Acceptance Criteria

1. THE Auth_Service SHALL 创建 `linked_accounts` 表，包含字段：`id`（主键）、`user_id`（外键关联 users 表）、`provider`（身份提供商名称，如 "github"）、`provider_user_id`（GitHub 用户 ID）、`provider_username`、`access_token`、`created_at`、`updated_at`
2. THE Auth_Service SHALL 在 `linked_accounts` 表上创建 `(provider, provider_user_id)` 的唯一索引
3. THE Auth_Service SHALL 通过数据库迁移机制创建 `linked_accounts` 表，与现有迁移模式保持一致
4. THE Auth_Service SHALL 创建 `oauth_states` 表，包含字段：`state`（主键）、`expires_at`、`created_at`，用于存储 OAuth state 参数

---

### Requirement 7: 安全性要求

**User Story:** 作为系统管理员，我希望 GitHub OAuth 集成遵循安全最佳实践，以便保护用户账户安全。

#### Acceptance Criteria

1. THE OAuth_State_Store SHALL 使用 `crypto.randomBytes(32)` 生成 state 参数，确保不可预测性
2. THE GitHub_Callback_Handler SHALL 在验证 state 后立即从 OAuth_State_Store 中删除该 state，防止重放攻击
3. THE Auth_Service SHALL 不在前端 URL、日志或响应体中暴露 GitHub Client Secret
4. IF GitHub OAuth 流程中发生任何错误，THEN THE Auth_Service SHALL 在审计日志中记录 `GITHUB_LOGIN_FAILED` 事件，包含错误原因
5. THE Auth_Service SHALL 定期清理 `oauth_states` 表中已过期的 state 记录


---

### Requirement 8: 用户账户管理 - 查看已关联账户

**User Story:** 作为用户，我希望在个人资料页面查看已关联的 GitHub 账户，以便了解我的账户绑定状态。

#### Acceptance Criteria

1. THE Auth_Service SHALL 提供 `GET /api/user/linked-accounts` 端点，返回当前用户已关联的第三方账户列表
2. WHEN 用户请求已关联账户列表，THE Auth_Service SHALL 返回每条记录的 `provider`、`provider_username` 和 `created_at` 字段，不返回 `access_token`
3. THE Auth_Service SHALL 对 `GET /api/user/linked-accounts` 端点要求有效的 JWT 认证

---

### Requirement 9: 错误处理与用户反馈

**User Story:** 作为用户，我希望在 GitHub OAuth 流程出现错误时收到清晰的提示，以便了解问题所在并采取行动。

#### Acceptance Criteria

1. IF 用户在 GitHub 授权页面点击取消，THEN THE GitHub_Callback_Handler SHALL 将用户重定向至登录页面并显示提示信息 "GitHub authorization was cancelled"
2. IF GitHub 返回错误响应，THEN THE GitHub_Callback_Handler SHALL 将用户重定向至登录页面并附带可读的错误描述
3. WHEN 用户被重定向至登录页面时携带错误参数，THE Login_Page SHALL 展示对应的错误提示信息
4. IF GitHub OAuth 配置缺失，THEN THE Login_Page SHALL 隐藏"使用 GitHub 登录"按钮，或将其显示为禁用状态
