状态：archived
范围：example/
最后核对：2026-03-23
事实来源：example/ 目录结构
替代文档：无（文档描述的功能已在主应用 server/routes/user.ts 中实现，但 example/ 中未实现对应接入）

---

# Refresh Token 和多设备会话管理功能说明（历史文档）

> [!NOTE]
> **本文档已归档。** 原因：文档中引用了 `src/views/Sessions.vue`、`src/stores/auth.ts`、`axios` 拦截器等文件或结构，但当前 `example/` 目录并不存在这些实现。文档描述的功能已在主应用中实现（见 `server/routes/user.ts`、`server/schema.ts` 中的 `sessions` 和 `refresh_tokens` 表），但 example/ 的接入示例尚未完成。
>
> 如需了解当前会话管理能力，请参阅主应用的 `server/routes/user.ts` 中的会话相关端点。

---

## 📋 功能概览（主应用已实现）

主应用已实现完整的 Refresh Token 机制和多设备会话管理功能：

### Refresh Token 机制
- 登录时生成双 Token：Access Token（15 分钟）+ Refresh Token（7 天，记住我 30 天）
- `/api/auth/refresh` 端点支持 token 刷新，刷新时自动轮换 refresh token
- Token 配置集中在 `server/config.ts` 的 `TOKEN_CONFIG`

### 会话管理系统
- `GET /api/user/sessions` - 用户查看自己的所有会话
- `DELETE /api/user/sessions/:id` - 用户撤销指定会话
- `DELETE /api/admin/sessions/:id` - 管理员撤销任意会话
- 撤销时自动失效相关的 refresh tokens

### 数据库结构（已实现）

`server/schema.ts` 中定义了以下相关表：
- `sessions` - 会话记录（设备信息、IP 地址、最后活跃时间）
- `refresh_tokens` - Refresh Token 存储（关联用户和客户端）

---

## 🔧 Vue 示例接入（未完成）

> ⚠️ 以下内容描述了预期的 Vue 示例接入方式，但当前 `example/` 中未实现。

### 预期的 Axios 拦截器自动刷新
- 请求拦截：自动添加 Access Token 和 Session ID
- 响应拦截：401 错误时自动刷新 token
- 请求队列：避免并发刷新问题
- 刷新失败：自动跳转登录页

### 预期的会话管理页面
- 显示所有活跃会话
- 标识当前会话
- 显示设备信息、IP、最后活跃时间
- 支持远程撤销其他设备会话

---

## 📝 后续改进建议

1. **完善 Vue 示例接入**：在 `example/` 中实现会话管理功能
2. **设备指纹**：添加更详细的设备识别
3. **地理定位**：根据 IP 显示地理位置，异常登录地点提醒
4. **会话过期清理**：定期清理过期会话，添加会话过期策略
5. **并发限制**：限制同一用户的最大会话数，最老会话自动踢出
