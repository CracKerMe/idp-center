# 实现计划：认证系统增强（auth-system-enhancements）

## 概述

基于设计文档和需求文档，将九个增强模块分解为可增量执行的编码任务。实现顺序为：基础设施（环境变量校验、数据库迁移、邮件服务）→ 核心安全功能（账号锁定、邮箱验证、GDPR 注销、头像、设备信任、Token 清理）→ OIDC 合规 → 管理后台完善 → 前端适配。

## 任务列表

- [x] 1. 环境变量 Zod 校验（模块 7）
  - [x] 1.1 在 `server.ts` 顶部实现 `EnvSchema` Zod 校验，覆盖 `JWT_SECRET`、`JWT_REFRESH_SECRET`（必填，≥32 字符）、`NODE_ENV`、`PORT`、`APP_URL`、SMTP 可选字段、GitHub OAuth 可选字段、`ENCRYPTION_KEY` 可选字段；校验失败时打印 `fieldErrors` 并 `process.exit(1)`；导出 `config` 对象替换全局 `process.env` 直接访问
    - _需求：7.1、7.2、7.3、7.4_

  - [ ]* 1.2 为 `EnvSchema` 编写属性测试
    - **属性 15：环境变量 schema 拒绝无效配置**
    - **验证：需求 7.1**

- [x] 2. 数据库迁移：新增表与字段（模块 1/3/5/9）
  - [x] 2.1 在 `server.ts` 的迁移区块中添加以下内容：
    - `users` 表新增 `email_verified INTEGER DEFAULT 0`、`email_verified_at DATETIME`
    - `refresh_tokens` 表新增 `remember_me INTEGER DEFAULT 0`、`device_id TEXT`
    - `auth_codes` 表新增 `nonce TEXT`、`scope TEXT DEFAULT 'openid'`、`code_challenge TEXT`、`code_challenge_method TEXT DEFAULT 'S256'`
    - 新建 `email_verifications` 表（含 `id`、`user_id`、`token`、`type`、`new_email`、`expires_at`、`used`、`created_at`）
    - 新建 `trusted_devices` 表（含 `id`、`user_id`、`device_fingerprint`、`device_name`、`trusted_at`、`expires_at`、`last_used_at`）
    - 新建 `account_deletion_requests` 表（含 `id`、`user_id`、`requested_at`、`scheduled_delete_at`、`cancelled_at`、`completed_at`、`status`）
    - _需求：1.1、3.1、5.3、9.3_

- [x] 3. 邮件服务（模块 1）
  - [x] 3.1 实现 `EmailService` 类（可放在 `server.ts` 或独立模块），使用 `nodemailer` 创建 SMTP transporter，实现 `sendVerificationEmail`、`sendPasswordResetEmail`、`sendAccountDeletionConfirmEmail` 三个方法；当 SMTP 未配置时降级为 console.log 输出（开发模式）
    - _需求：1.1、1.6、1.7、1.8、3.1、8.3_

- [x] 4. 账号安全加固：登录锁定（模块 2）
  - [x] 4.1 修改 `POST /api/auth/login` 处理逻辑：
    - 登录前检查 `locked_until`，若未过期则返回 `401 { error: 'ACCOUNT_LOCKED', unlock_at }`
    - 密码错误时递增 `failed_login_attempts`，达到阈值（默认 5）时设置 `locked_until = now + 15min`
    - 密码正确时重置 `failed_login_attempts = 0`、`locked_until = NULL`
    - _需求：2.1、2.2、2.3_

  - [ ]* 4.2 为登录锁定逻辑编写属性测试
    - **属性 4：登录失败计数达阈值后账号锁定**
    - **属性 5：成功登录重置失败计数**
    - **验证：需求 2.1、2.2、2.3**

- [x] 5. 邮箱验证流程（模块 1）
  - [x] 5.1 修改 `POST /api/auth/register`：注册成功后生成 `email_verifications` 记录（type='registration'，有效期 24h），调用 `EmailService.sendVerificationEmail`
    - _需求：1.1_

  - [x] 5.2 修改 `POST /api/auth/login`：在密码/OTP 验证通过后检查 `email_verified`，若为 0 则返回 `403 { error: 'EMAIL_NOT_VERIFIED' }`
    - _需求：1.2_

  - [x] 5.3 实现 `POST /api/auth/email/verify`：查找未使用且未过期的 token，更新 `email_verified=1`、`email_verified_at`、`used=1`；已使用或过期 token 返回错误
    - _需求：1.3、1.4、1.5_

  - [x] 5.4 实现 `POST /api/auth/email/resend`：为当前用户生成新的验证 token 并调用 `EmailService.sendVerificationEmail`
    - _需求：1.6_

  - [x] 5.5 修改 `POST /api/auth/password/reset-request`：移除响应体中的 `token` 字段，改为调用 `EmailService.sendPasswordResetEmail` 发送邮件
    - _需求：1.7_

  - [ ]* 5.6 为邮箱验证编写属性测试
    - **属性 1：邮箱未验证账号无法登录**
    - **属性 2：验证 token 一次性使用**
    - **属性 3：密码重置响应不暴露 token**
    - **验证：需求 1.2、1.4、1.7**

- [x] 6. 密码修改后撤销旧 token（模块 2）
  - [x] 6.1 在密码修改接口（`PUT /api/user/profile` 或独立密码修改接口）中，修改密码成功后执行 `UPDATE access_tokens SET revoked=1 WHERE user_id=?`（排除当前 token）和 `UPDATE refresh_tokens SET revoked=1 WHERE user_id=?`（排除当前 session 关联的 token）
    - _需求：2.4_

  - [ ]* 6.2 为密码修改后 token 失效编写属性测试
    - **属性 6：密码修改后旧 token 失效**
    - **验证：需求 2.4**

- [x] 7. GDPR 账号注销（模块 3）
  - [x] 7.1 实现 `POST /api/user/account/delete-request`：创建 `account_deletion_requests` 记录（`scheduled_delete_at = now + 30 days`，`status='pending'`），调用 `EmailService.sendAccountDeletionConfirmEmail`；若用户已有 pending 请求则返回错误
    - _需求：3.1_

  - [x] 7.2 实现 `DELETE /api/user/account/delete-request`：将对应 pending 请求的 `status` 更新为 `cancelled`、`cancelled_at = now`
    - _需求：3.2_

  - [x] 7.3 实现 `GET /api/user/account/delete-request`：返回当前用户的注销申请状态
    - _需求：3.1_

  - [x] 7.4 实现账号注销执行函数 `executeAccountDeletion(userId)`：匿名化 `email`/`username`/`password_hash`/`full_name`/`phone`/`avatar_url`，撤销所有 token 和 session，删除 `linked_accounts`，更新 `is_active=0`，更新请求状态为 `completed`；审计日志保留不删除
    - _需求：3.3、3.4、3.5_

  - [x] 7.5 修改 `POST /api/auth/login`：检查用户是否有 `pending` 注销申请，若有则返回 `403 { error: 'ACCOUNT_PENDING_DELETION' }`
    - _需求：3.6_

  - [ ]* 7.6 为 GDPR 注销编写属性测试
    - **属性 7：注销冷静期计算正确性**
    - **属性 8：注销后个人数据匿名化**
    - **属性 9：注销后审计日志保留**
    - **验证：需求 3.1、3.3、3.5**

- [x] 8. 检查点 - 确保所有测试通过
  - 确保所有测试通过，如有问题请向用户提问。

- [x] 9. 头像管理（模块 4）
  - [x] 9.1 配置 `multer` 中间件：限制文件大小 2MB，仅接受 `image/jpeg`、`image/png`、`image/webp` MIME 类型，存储路径为 `uploads/avatars/{userId}.{ext}`；配置 Express 静态文件服务 `/api/uploads` → `uploads/`
    - _需求：4.1、4.2、4.3_

  - [x] 9.2 实现 `POST /api/user/avatar`：使用 multer 处理上传，存储文件，更新 `users.avatar_url`，返回可访问的头像 URL
    - _需求：4.1_

  - [x] 9.3 实现 `PUT /api/user/avatar/url`：接受外部 URL，更新 `users.avatar_url`
    - _需求：4.4_

  - [x] 9.4 实现 `DELETE /api/user/avatar`：清空 `users.avatar_url`
    - _需求：4.5_

  - [ ]* 9.5 为头像上传编写属性测试
    - **属性 10：头像文件类型和大小校验**
    - **验证：需求 4.1、4.2、4.3**

- [x] 10. 记住我 / 设备信任（模块 5）
  - [x] 10.1 修改 `POST /api/auth/login`：读取 `remember_me` 字段，`true` 时 refresh token 有效期设为 30 天，否则 7 天；在 `refresh_tokens` 记录中写入 `remember_me` 字段
    - _需求：5.1、5.2_

  - [x] 10.2 修改 `POST /api/auth/login`：读取 `trust_device` 字段，`true` 时计算设备指纹（`HMAC-SHA256(userAgent + ip + salt)`），在 `trusted_devices` 表中插入或更新记录（有效期 30 天），响应中返回 `device_trusted: true`
    - _需求：5.3_

  - [x] 10.3 修改 `POST /api/auth/login` 中的 OTP 检查逻辑：在要求 OTP 之前，先查询 `trusted_devices` 表中是否存在匹配当前设备指纹且未过期的记录，若存在则跳过 OTP 验证
    - _需求：5.4_

  - [x] 10.4 实现 `GET /api/user/trusted-devices`：返回当前用户所有未过期的受信任设备列表
    - _需求：5.5_

  - [x] 10.5 实现 `DELETE /api/user/trusted-devices/:id`：删除指定受信任设备记录
    - _需求：5.6_

  - [ ]* 10.6 为记住我和设备信任编写属性测试
    - **属性 11：记住我影响 refresh token 有效期**
    - **属性 12：受信任设备免 OTP 验证**
    - **验证：需求 5.1、5.2、5.4**

- [x] 11. Token 清理（模块 6）
  - [x] 11.1 实现 `cleanupExpiredTokens()` 函数：删除 `access_tokens`（过期）、`auth_codes`（过期）、`oauth_states`（过期）、`trusted_devices`（过期）中的过期记录；仅删除 `refresh_tokens` 中已过期且 `revoked=1` 的记录；仅删除 `password_resets` 中已过期且 `used=1` 的记录；返回 `CleanupResult` 对象
    - _需求：6.3、6.4、6.5、6.6_

  - [x] 11.2 在服务启动时调用一次 `cleanupExpiredTokens()`，并使用 `setInterval` 每小时执行一次
    - _需求：6.1、6.2_

  - [x] 11.3 实现 `POST /api/admin/maintenance/cleanup-tokens`：调用 `cleanupExpiredTokens()` 并返回 `CleanupResult`
    - _需求：6.7_

  - [ ]* 11.4 为 Token 清理编写属性测试
    - **属性 13：Token 清理不误删有效记录**
    - **属性 14：Token 清理结果数值非负**
    - **验证：需求 6.3、6.4、6.5、6.6**

- [x] 12. 检查点 - 确保所有测试通过
  - 确保所有测试通过，如有问题请向用户提问。

- [x] 13. OIDC 标准合规性（模块 9）
  - [x] 13.1 实现 `GET /.well-known/openid-configuration`：返回符合 OIDC Discovery 规范的 JSON 文档，包含 `issuer`（使用 `config.APP_URL`）、`authorization_endpoint`、`token_endpoint`、`userinfo_endpoint`、`jwks_uri`、`response_types_supported: ["code"]`、`scopes_supported: ["openid","profile","email"]`、`id_token_signing_alg_values_supported: ["HS256"]`、`code_challenge_methods_supported: ["S256"]` 等字段
    - _需求：9.1_

  - [x] 13.2 实现 `GET /.well-known/jwks.json`：返回用于验证 id_token 签名的密钥集合（当前使用 HS256 时可返回空 keys 数组或对称密钥描述符）
    - _需求：9.2_

  - [x] 13.3 修改 `POST /api/oidc/authorize`（GET 和 POST）：
    - 严格校验 `redirect_uri` 是否在客户端注册的 `redirect_uris` 白名单中，不在则返回 `400 { error: 'INVALID_REDIRECT_URI' }`
    - 接受并存储 `nonce`、`scope`、`code_challenge`、`code_challenge_method` 到 `auth_codes` 记录
    - _需求：9.3、9.5、9.6_

  - [x] 13.4 修改 `POST /api/oidc/token`：
    - 若 `auth_codes` 记录中存在 `code_challenge`，则验证请求中的 `code_verifier`（`BASE64URL(SHA256(code_verifier)) === code_challenge`），不匹配时返回 `400 { error: 'INVALID_CODE_VERIFIER' }`
    - 在颁发的 `id_token` 中包含 `nonce` claim（若授权时有 nonce）
    - 在 `access_tokens` 记录中存储授权时的 `scope`
    - _需求：9.4、9.5_

  - [x] 13.5 修改 `GET /api/oidc/userinfo`：根据 access_token 关联的 scope 过滤返回字段：仅 `openid` 时只返回 `sub`；含 `email` 时加入 `email`；含 `profile` 时加入 `name`、`username` 等字段
    - _需求：9.7、9.8、9.9_

  - [x] 13.6 在 `POST /api/oidc/token` 中新增 `refresh_token` grant type 支持：验证 refresh_token 有效性，颁发新的 access_token 和 id_token
    - _需求：9.10_

  - [ ]* 13.7 为 OIDC 合规性编写属性测试
    - **属性 18：PKCE code_verifier 验证正确性**
    - **属性 19：nonce 在 id_token 中原样传递**
    - **属性 20：userinfo 按 scope 过滤字段**
    - **验证：需求 9.4、9.5、9.7、9.8、9.9**

- [x] 14. 管理后台后端 API 完善（模块 8）
  - [x] 14.1 实现用户管理 API：
    - `PUT /api/admin/users/:id`：更新 `email`、`is_admin`、`is_active`
    - `DELETE /api/admin/users/:id`：软删除（`is_active=0`）
    - `POST /api/admin/users/:id/ban`：设置 `is_active=0`，撤销所有 access_token 和 refresh_token
    - `POST /api/admin/users/:id/unban`：设置 `is_active=1`
    - `POST /api/admin/users/:id/reset-password`：更新密码哈希，调用 `EmailService.sendPasswordResetEmail`
    - _需求：8.1、8.2、8.3_

  - [x] 14.2 实现客户端管理 API：
    - `PUT /api/admin/clients/:id`：更新 `client_name`、`redirect_uris`
    - `DELETE /api/admin/clients/:id`：删除客户端记录
    - `POST /api/admin/clients/:id/rotate-secret`：生成新 `client_secret` 并更新
    - _需求：8.4、8.5、8.6_

  - [x] 14.3 增强 `GET /api/admin/audit`：支持 `action`、`user_id`、`start_date`、`end_date` 过滤参数和 `page`、`pageSize` 分页参数，动态构建 SQL WHERE 子句
    - _需求：8.7、8.8_

  - [ ]* 14.4 为管理后台编写属性测试
    - **属性 16：封禁用户后 token 全部失效**
    - **属性 17：审计日志过滤结果一致性**
    - **验证：需求 8.1、8.7**

- [x] 15. 检查点 - 确保所有测试通过
  - 确保所有测试通过，如有问题请向用户提问。

- [x] 16. 前端：Profile 页面头像与账号注销（模块 3/4）
  - [x] 16.1 修改 `src/pages/Profile.tsx`：展示当前头像（`<img>` 或默认占位符），添加"上传头像"按钮（`<input type="file">`）和"使用 URL"输入框，调用 `POST /api/user/avatar` 或 `PUT /api/user/avatar/url`
    - _需求：4.1、4.4_

  - [x] 16.2 在 `src/pages/Profile.tsx` 中添加"申请注销账号"入口，展示注销状态（pending/cancelled），提供"取消注销"按钮，调用对应 API
    - _需求：3.1、3.2_

- [x] 17. 前端：登录页面记住我与设备信任（模块 5）
  - [x] 17.1 修改 `src/pages/Login.tsx`：添加"记住我"复选框（`remember_me`）和"信任此设备"复选框（`trust_device`），在登录请求中携带这两个字段
    - _需求：5.1、5.3_

- [x] 18. 前端：管理后台完善（模块 8）
  - [x] 18.1 修改 `src/pages/admin/UsersList.tsx`：为每行用户添加操作按钮（封禁/解封、重置密码、删除），实现用户编辑弹窗（编辑 email、is_admin），调用对应后端 API
    - _需求：8.1、8.2、8.3_

  - [x] 18.2 修改 `src/pages/admin/ClientsList.tsx`：添加编辑弹窗（name、redirect_uris）、删除按钮、轮换 Secret 按钮，调用对应后端 API
    - _需求：8.4、8.5、8.6_

  - [x] 18.3 实现 `src/pages/admin/TenantsList.tsx`：展示租户列表，提供创建/编辑表单，调用现有租户 CRUD API
    - _需求：8（租户管理前端）_

  - [x] 18.4 修改 `src/pages/admin/AuditLogs.tsx`：添加过滤器（action 下拉、user_id 输入、日期范围选择器）和分页控件，将过滤参数传递给 `GET /api/admin/audit`
    - _需求：8.7、8.8_

- [x] 19. 最终检查点 - 确保所有测试通过
  - 确保所有测试通过，如有问题请向用户提问。

## 备注

- 标有 `*` 的子任务为可选项，可跳过以加快 MVP 交付
- 每个任务均引用具体需求条款以保证可追溯性
- 检查点任务确保增量验证，避免问题积累
- 属性测试验证系统的普遍正确性，单元测试验证具体示例和边界条件
- 测试框架：vitest + fast-check（已在 package.json 中配置）
