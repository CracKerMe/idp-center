# 需求文档：认证系统增强（auth-system-enhancements）

## 简介

本文档描述对现有 IdP Center 认证系统的九项增强需求，涵盖 SMTP 邮件发送与邮箱验证、账号安全加固、GDPR 合规注销、头像管理、设备信任、Token 清理、环境变量校验、管理后台完善以及 OIDC 标准合规性。所有需求均基于已批准的设计文档派生，不破坏现有接口契约。

---

## 术语表

- **系统（System）**：IdP Center 认证服务，基于 Express + SQLite + JWT 构建
- **邮件服务（EmailService）**：负责通过 SMTP 发送各类通知邮件的模块
- **验证器（Validator）**：负责校验输入数据合法性的模块
- **Token 清理器（TokenCleaner）**：负责定期清理过期 Token 和会话记录的模块
- **环境校验器（EnvValidator）**：负责在服务启动时校验环境变量的模块
- **OIDC 模块（OIDCModule）**：负责处理 OpenID Connect 授权流程的模块
- **管理后台（AdminPanel）**：供管理员操作用户、客户端、租户和审计日志的后台界面
- **设备信任（TrustedDevice）**：记录用户受信任设备，允许免 OTP 登录的机制
- **PKCE**：Proof Key for Code Exchange，OAuth 2.1 授权码流程的安全扩展
- **冷静期（GracePeriod）**：账号注销申请后的 30 天等待期，期间可取消注销

---

## 需求列表

### 需求 1：SMTP 邮件发送与邮箱验证

**用户故事：** 作为一名用户，我希望注册后收到验证邮件并完成邮箱验证，以便确保账号安全性和邮件通知的可达性。

#### 验收标准

1. WHEN 用户完成注册，THE 系统 SHALL 通过 EmailService 向注册邮箱发送包含验证链接的验证邮件
2. WHEN 用户尝试登录且邮箱未验证，THE 系统 SHALL 返回 HTTP 403 状态码及错误码 `EMAIL_NOT_VERIFIED`
3. WHEN 用户提交有效的邮箱验证 token，THE 系统 SHALL 将该用户的 `email_verified` 字段更新为 1 并记录验证时间
4. WHEN 用户提交已使用过的邮箱验证 token，THE 系统 SHALL 返回错误并拒绝验证
5. WHEN 用户提交已过期的邮箱验证 token，THE 系统 SHALL 返回错误并拒绝验证
6. WHEN 用户请求重新发送验证邮件，THE 系统 SHALL 生成新的验证 token 并通过 EmailService 发送
7. WHEN 用户请求密码重置，THE 系统 SHALL 通过 EmailService 发送包含重置链接的邮件，且响应体中不包含重置 token
8. THE 系统 SHALL 提供统一的 EmailService 接口，支持发送验证邮件、密码重置邮件和账号注销确认邮件

---

### 需求 2：账号安全能力增强

**用户故事：** 作为一名用户，我希望系统能防止暴力破解攻击，以便保护我的账号不被未授权访问。

#### 验收标准

1. WHEN 用户连续登录失败次数达到配置阈值（默认 5 次），THE 系统 SHALL 锁定该账号并设置解锁时间（默认 15 分钟后）
2. WHEN 用户尝试登录已锁定的账号，THE 系统 SHALL 返回 HTTP 401 状态码、错误码 `ACCOUNT_LOCKED` 及 `unlock_at` 时间戳
3. WHEN 用户成功登录，THE 系统 SHALL 将该用户的 `failed_login_attempts` 重置为 0 并清除 `locked_until`
4. WHEN 用户修改密码，THE 系统 SHALL 撤销该用户除当前会话外的所有 access_token 和 refresh_token

---

### 需求 3：账号注销（GDPR 合规）

**用户故事：** 作为一名用户，我希望能够申请注销账号并在冷静期内取消，以便行使数据删除权利同时防止误操作。

#### 验收标准

1. WHEN 用户提交账号注销申请，THE 系统 SHALL 创建注销请求记录，将 `scheduled_delete_at` 设置为申请时间加 30 天，并通过 EmailService 发送确认邮件
2. WHEN 用户在冷静期内取消注销申请，THE 系统 SHALL 将注销请求状态更新为 `cancelled`
3. WHEN 注销冷静期结束且状态为 `pending`，THE 系统 SHALL 执行数据匿名化：清除 `password_hash`、将 `email` 替换为 `deleted_{uuid}@deleted`、将 `username` 替换为 `deleted_{uuid}`、清除 `full_name`、`phone`、`avatar_url`
4. WHEN 账号注销执行完成，THE 系统 SHALL 撤销该用户的所有 token 和 session，并删除所有 linked_accounts 记录
5. WHEN 账号注销执行完成，THE 系统 SHALL 保留该用户的审计日志记录（仅保留 user_id 引用）
6. WHEN 处于注销冷静期的用户尝试登录，THE 系统 SHALL 返回 HTTP 403 状态码及错误码 `ACCOUNT_PENDING_DELETION`

---

### 需求 4：头像修改入口

**用户故事：** 作为一名用户，我希望能够上传或设置头像，以便个性化我的账号展示。

#### 验收标准

1. WHEN 用户上传符合要求的图片文件（jpg/png/webp，不超过 2MB），THE 系统 SHALL 将文件存储至 `/uploads/avatars/{userId}.{ext}` 并更新用户的 `avatar_url` 字段
2. WHEN 用户上传超过 2MB 的文件，THE 系统 SHALL 拒绝上传并返回错误
3. WHEN 用户上传非 jpg/png/webp 格式的文件，THE 系统 SHALL 拒绝上传并返回错误
4. WHEN 用户提交有效的外部头像 URL，THE 系统 SHALL 更新用户的 `avatar_url` 字段为该 URL
5. WHEN 用户删除头像，THE 系统 SHALL 将用户的 `avatar_url` 字段清空并恢复默认头像

---

### 需求 5：记住我 / 设备信任

**用户故事：** 作为一名用户，我希望能够选择"记住我"并信任当前设备，以便在常用设备上减少重复认证操作。

#### 验收标准

1. WHEN 用户登录时携带 `remember_me: true`，THE 系统 SHALL 生成有效期为 30 天的 refresh token
2. WHEN 用户登录时未携带 `remember_me` 或 `remember_me: false`，THE 系统 SHALL 生成有效期为 7 天的 refresh token
3. WHEN 用户登录时携带 `trust_device: true`，THE 系统 SHALL 在 `trusted_devices` 表中记录设备指纹（HMAC-SHA256 哈希），有效期 30 天
4. WHEN 已信任设备的用户登录且 OTP 已启用，THE 系统 SHALL 跳过 OTP 验证步骤
5. WHEN 用户请求受信任设备列表，THE 系统 SHALL 返回该用户所有有效的受信任设备记录
6. WHEN 用户撤销指定受信任设备，THE 系统 SHALL 从 `trusted_devices` 表中删除该记录，后续该设备登录需重新进行 OTP 验证

---

### 需求 6：Token 清理

**用户故事：** 作为一名系统管理员，我希望过期的 Token 和会话记录能被自动清理，以便控制数据库体积并维护系统性能。

#### 验收标准

1. WHEN 服务启动，THE 系统 SHALL 立即执行一次过期 Token 清理
2. WHILE 服务运行，THE 系统 SHALL 每小时自动执行一次过期 Token 清理
3. WHEN Token 清理执行，THE TokenCleaner SHALL 删除 `access_tokens`、`auth_codes`、`oauth_states`、`trusted_devices` 表中所有 `expires_at` 早于当前时间的记录
4. WHEN Token 清理执行，THE TokenCleaner SHALL 仅删除 `refresh_tokens` 表中同时满足已过期且 `revoked = 1` 的记录
5. WHEN Token 清理执行，THE TokenCleaner SHALL 仅删除 `password_resets` 表中同时满足已过期且 `used = 1` 的记录
6. WHEN Token 清理执行完成，THE TokenCleaner SHALL 返回包含各表删除数量的 CleanupResult 对象，所有数量值均为非负整数
7. WHEN 管理员调用手动清理 API（`POST /api/admin/maintenance/cleanup-tokens`），THE 系统 SHALL 立即执行清理并在响应中返回 CleanupResult

---

### 需求 7：全局必须的环境变量 Zod 校验

**用户故事：** 作为一名运维人员，我希望服务在配置不完整时能立即报错退出，以便快速发现配置问题而不是在运行时静默失败。

#### 验收标准

1. WHEN 服务启动时 `JWT_SECRET` 或 `JWT_REFRESH_SECRET` 缺失或长度不足 32 字符，THE EnvValidator SHALL 向 stderr 输出详细错误信息并以退出码 1 终止进程
2. WHEN 服务启动时所有必填环境变量均有效，THE EnvValidator SHALL 允许服务正常启动
3. WHEN 可选环境变量（如 `PORT`、`NODE_ENV`、`APP_URL`）未配置，THE EnvValidator SHALL 使用预定义的合理默认值（PORT=5986，NODE_ENV=development，APP_URL=http://localhost:5986）
4. WHEN 环境变量校验失败，THE EnvValidator SHALL 在错误信息中明确列出所有不合规的字段名称及原因

---

### 需求 8：管理后台完善

**用户故事：** 作为一名系统管理员，我希望能够通过管理后台对用户、客户端和租户进行完整的 CRUD 操作，以便高效管理系统资源。

#### 验收标准

1. WHEN 管理员封禁用户，THE 系统 SHALL 将该用户的 `is_active` 设置为 0 并撤销其所有 access_token 和 refresh_token
2. WHEN 管理员解封用户，THE 系统 SHALL 将该用户的 `is_active` 设置为 1
3. WHEN 管理员强制重置用户密码，THE 系统 SHALL 更新密码哈希并通过 EmailService 向该用户发送密码重置通知邮件
4. WHEN 管理员编辑客户端信息（name、redirect_uris），THE 系统 SHALL 更新数据库中对应客户端记录
5. WHEN 管理员删除客户端，THE 系统 SHALL 从数据库中移除该客户端记录
6. WHEN 管理员轮换客户端 secret，THE 系统 SHALL 生成新的 `client_secret` 并更新数据库
7. WHEN 管理员查询审计日志时携带过滤参数（action、user_id、日期范围），THE 系统 SHALL 仅返回满足所有过滤条件的日志记录
8. WHEN 管理员查询审计日志时携带分页参数（page、pageSize），THE 系统 SHALL 返回对应页码的记录，且返回数量不超过 pageSize

---

### 需求 9：OIDC 标准合规性

**用户故事：** 作为一名第三方应用开发者，我希望 IdP Center 符合 OIDC Core 1.0 标准，以便使用标准客户端库接入认证服务。

#### 验收标准

1. THE 系统 SHALL 在 `/.well-known/openid-configuration` 提供 Discovery 端点，返回包含 `issuer`、`authorization_endpoint`、`token_endpoint`、`userinfo_endpoint`、`jwks_uri`、`response_types_supported`、`scopes_supported`、`id_token_signing_alg_values_supported`、`code_challenge_methods_supported` 等必需字段的 JSON 文档
2. THE 系统 SHALL 在 `/.well-known/jwks.json` 提供 JWKS 端点，返回用于验证 id_token 签名的公钥集合
3. WHEN 授权请求包含 `code_challenge` 和 `code_challenge_method=S256`，THE OIDCModule SHALL 将 code_challenge 与授权码关联存储
4. WHEN token 请求包含 `code_verifier`，THE OIDCModule SHALL 验证 `BASE64URL(SHA256(code_verifier))` 与存储的 `code_challenge` 一致，验证失败时返回 HTTP 400 及错误码 `INVALID_CODE_VERIFIER`
5. WHEN 授权请求包含 `nonce` 参数，THE OIDCModule SHALL 在颁发的 id_token 中包含相同的 `nonce` claim
6. WHEN 授权请求的 `redirect_uri` 不在客户端注册的白名单中，THE OIDCModule SHALL 返回 HTTP 400 及错误码 `INVALID_REDIRECT_URI`
7. WHEN userinfo 请求的 access_token 对应的授权 scope 仅包含 `openid`，THE OIDCModule SHALL 仅返回 `sub` 字段，不返回 `email`、`name` 等 profile 字段
8. WHEN userinfo 请求的 access_token 对应的授权 scope 包含 `email`，THE OIDCModule SHALL 在响应中包含 `email` 字段
9. WHEN userinfo 请求的 access_token 对应的授权 scope 包含 `profile`，THE OIDCModule SHALL 在响应中包含 `name`、`username` 等 profile 字段
10. THE OIDCModule SHALL 支持 `refresh_token` grant type，允许客户端使用 refresh_token 换取新的 access_token 和 id_token

---

## 正确性属性

*属性是在系统所有有效执行中都应成立的特征或行为——本质上是关于系统应做什么的形式化陈述。属性是人类可读规范与机器可验证正确性保证之间的桥梁。*

### 属性 1：邮箱未验证账号无法登录

*对于任意* 已注册但 `email_verified = 0` 的用户，尝试使用正确凭据登录时，系统应返回 HTTP 403 及错误码 `EMAIL_NOT_VERIFIED`

**验证需求：需求 1.2**

---

### 属性 2：验证 token 一次性使用

*对于任意* 有效的邮箱验证 token，第一次使用后再次提交相同 token，系统应拒绝并返回错误

**验证需求：需求 1.4**

---

### 属性 3：密码重置响应不暴露 token

*对于任意* 密码重置请求，系统响应体中不应包含 `token` 字段

**验证需求：需求 1.7**

---

### 属性 4：登录失败计数达阈值后账号锁定

*对于任意* 用户，连续登录失败次数达到配置阈值后，下一次登录尝试应返回 `ACCOUNT_LOCKED` 错误及 `unlock_at` 字段

**验证需求：需求 2.1、需求 2.2**

---

### 属性 5：成功登录重置失败计数

*对于任意* 用户，在若干次失败登录后成功登录，`failed_login_attempts` 应归零且 `locked_until` 应为 null

**验证需求：需求 2.3**

---

### 属性 6：密码修改后旧 token 失效

*对于任意* 用户，修改密码后，该用户之前颁发的所有 access_token 应被撤销，使用旧 token 的请求应返回 401

**验证需求：需求 2.4**

---

### 属性 7：注销冷静期计算正确性

*对于任意* 注销申请，`scheduled_delete_at` 应等于 `requested_at` 加 30 天（误差不超过 1 秒）

**验证需求：需求 3.1**

---

### 属性 8：注销后个人数据匿名化

*对于任意* 已完成注销的用户，其 `email`、`username`、`password_hash`、`full_name`、`phone`、`avatar_url` 字段均不应包含原始个人信息

**验证需求：需求 3.3**

---

### 属性 9：注销后审计日志保留

*对于任意* 已完成注销的用户，该用户在注销前产生的审计日志记录应仍然存在于数据库中

**验证需求：需求 3.5**

---

### 属性 10：头像文件类型和大小校验

*对于任意* 文件上传请求，超过 2MB 或非 jpg/png/webp 格式的文件应被拒绝；符合条件的文件应被接受并存储

**验证需求：需求 4.1、需求 4.2、需求 4.3**

---

### 属性 11：记住我影响 refresh token 有效期

*对于任意* 登录请求，`remember_me=true` 时颁发的 refresh token 有效期应为 30 天，`remember_me=false` 或未设置时应为 7 天

**验证需求：需求 5.1、需求 5.2**

---

### 属性 12：受信任设备免 OTP 验证

*对于任意* 已启用 OTP 的用户，使用已信任设备登录时，系统不应要求提交 OTP 即可完成登录

**验证需求：需求 5.4**

---

### 属性 13：Token 清理不误删有效记录

*对于任意* 未过期且未撤销的 token 记录，执行 Token 清理后该记录应仍然存在于数据库中

**验证需求：需求 6.3、需求 6.4、需求 6.5**

---

### 属性 14：Token 清理结果数值非负

*对于任意* 数据库状态，执行 Token 清理后返回的 CleanupResult 中所有字段值均应为非负整数

**验证需求：需求 6.6**

---

### 属性 15：环境变量 schema 拒绝无效配置

*对于任意* 缺少必填字段或字段值不合规的环境变量集合，EnvValidator 的 Zod schema 解析应返回失败结果

**验证需求：需求 7.1**

---

### 属性 16：封禁用户后 token 全部失效

*对于任意* 用户，管理员封禁后，该用户所有 access_token 和 refresh_token 应被撤销，使用这些 token 的请求应返回 401

**验证需求：需求 8.1**

---

### 属性 17：审计日志过滤结果一致性

*对于任意* 过滤条件组合，返回的审计日志记录应全部满足所有过滤条件，不应包含不符合条件的记录

**验证需求：需求 8.7**

---

### 属性 18：PKCE code_verifier 验证正确性

*对于任意* code_verifier 字符串，`BASE64URL(SHA256(code_verifier))` 应与授权时存储的 code_challenge 完全一致；任何不匹配的 verifier 应导致 token 请求失败

**验证需求：需求 9.4**

---

### 属性 19：nonce 在 id_token 中原样传递

*对于任意* 包含 nonce 参数的授权请求，颁发的 id_token 中的 `nonce` claim 应与请求中的 nonce 值完全相同

**验证需求：需求 9.5**

---

### 属性 20：userinfo 按 scope 过滤字段

*对于任意* access_token，userinfo 端点返回的字段集合应严格对应该 token 授权时的 scope：仅 `openid` scope 时不返回 email/profile 字段；包含 `email` scope 时返回 email 字段；包含 `profile` scope 时返回 profile 字段

**验证需求：需求 9.7、需求 9.8、需求 9.9**
