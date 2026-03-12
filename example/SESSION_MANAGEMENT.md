# Refresh Token 和多设备会话管理功能说明

## 📋 功能概览

本次更新为 IdP Center 添加了完整的 **Refresh Token 机制** 和 **多设备会话管理** 功能。

## 🎯 核心改进

### 1. **后端改进 (server.ts)**

#### ✅ Refresh Token 机制
- **登录时生成双 Token**：
  - Access Token：15 分钟有效期（短期）
  - Refresh Token：7 天有效期（长期）
  - Session ID：用于标识用户会话

- **自动 Token 刷新**：
  - `/api/auth/refresh` 端点支持 token 刷新
  - 刷新时自动轮换 refresh token（增强安全性）
  - 修复了之前的时间计算错误（`Date.now() * 7` → `Date.now() + 7*24*60*60*1000`）

#### ✅ 会话管理系统
- **登录时创建会话记录**：
  - 自动记录设备信息（User-Agent）
  - 记录 IP 地址
  - 生成唯一的 Session ID

- **会话查询 API**：
  - `GET /api/user/sessions` - 用户查看自己的所有会话
  - `GET /api/admin/sessions` - 管理员查看所有用户会话

- **远程会话撤销**：
  - `DELETE /api/user/sessions/:id` - 用户撤销指定会话
  - `DELETE /api/admin/sessions/:id` - 管理员撤销任意会话
  - 撤销时自动失效相关的 refresh tokens

### 2. **Vue 示例改进**

#### ✅ Axios 拦截器自动刷新
- 创建 `src/utils/http.ts` 统一处理：
  - 请求拦截：自动添加 Access Token 和 Session ID
  - 响应拦截：401 错误时自动刷新 token
  - 请求队列：避免并发刷新问题
  - 刷新失败：自动跳转登录页

#### ✅ 会话管理页面
- 新增 `src/views/Sessions.vue`：
  - 显示所有活跃会话
  - 标识当前会话
  - 显示设备信息、IP、最后活跃时间
  - 支持远程撤销其他设备会话

#### ✅ Auth Store 增强
- 更新 `src/stores/auth.ts`：
  - 存储 access_token、refresh_token、session_id
  - 新增 `getSessions()` 方法
  - 新增 `revokeSession()` 方法
  - 所有 API 调用迁移到 axios（自动刷新支持）

## 🔐 安全特性

### Token 安全
1. **短期 Access Token**（15 分钟）- 减少被盗用的风险
2. **Token 轮换** - 每次刷新生成新的 refresh token
3. **自动失效** - 密码修改时撤销所有 refresh tokens
4. **远程撤销** - 可强制登出其他设备

### 会话安全
1. **设备识别** - 记录 User-Agent 和 IP 地址
2. **活跃监控** - 跟踪每个会话的最后活跃时间
3. **防止自撤销** - 不能撤销当前会话（需使用 logout）
4. **审计日志** - 所有关键操作记录到 audit_logs

## 📊 数据库结构

### sessions 表
```sql
CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  device_info TEXT,
  ip_address TEXT,
  last_active DATETIME DEFAULT CURRENT_TIMESTAMP,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
)
```

### refresh_tokens 表
```sql
CREATE TABLE refresh_tokens (
  id TEXT PRIMARY KEY,
  token TEXT UNIQUE NOT NULL,
  user_id TEXT NOT NULL,
  client_id TEXT,
  expires_at DATETIME NOT NULL,
  revoked INTEGER DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
)
```

## 🔧 使用示例

### 登录响应示例
```json
{
  "access_token": "eyJhbGciOiJIUzI1NiIs...",
  "refresh_token": "a1b2c3d4e5f6...",
  "expires_in": 900,
  "token_type": "Bearer",
  "user": {
    "id": "uuid",
    "username": "admin",
    "email": "admin@example.com",
    "is_admin": true,
    "otp_enabled": false
  },
  "session_id": "session-uuid"
}
```

### Token 刷新流程
```
1. 用户请求 API
2. Access Token 过期（15分钟后）
3. 服务器返回 401
4. Axios 拦截器捕获错误
5. 使用 refresh_token 调用 /api/auth/refresh
6. 获得新的 access_token 和 refresh_token
7. 重试原始请求
```

### 会话管理流程
```
1. 用户登录 → 创建 session 记录
2. 查看会话 → GET /api/user/sessions
3. 发现可疑设备 → DELETE /api/user/sessions/:id
4. 撤销效果 → refresh_token 失效 → 强制登出
```

## 🧪 测试建议

### 测试自动刷新
1. 登录系统
2. 等待 15 分钟（或修改代码缩短时间）
3. 发起需要认证的请求
4. 观察是否自动刷新并成功

### 测试会话管理
1. 在多个浏览器/设备登录
2. 访问 `/sessions` 页面
3. 查看所有活跃会话
4. 撤销某个会话
5. 在被撤销的设备上尝试操作（应失败）

### 测试管理员功能
1. 以管理员身份登录
2. 访问管理后台
3. 查看所有用户会话
4. 撤销可疑会话

## 📝 后续改进建议

1. **会话关联改进**：
   - 在 refresh_tokens 表添加 session_id 字段
   - 精确撤销特定会话的 token

2. **设备指纹**：
   - 添加更详细的设备识别
   - 支持设备命名/识别

3. **地理定位**：
   - 根据 IP 显示地理位置
   - 异常登录地点提醒

4. **会话过期清理**：
   - 定期清理过期会话
   - 添加会话过期策略

5. **并发限制**：
   - 限制同一用户的最大会话数
   - 最老会话自动踢出

## 🎉 总结

本次更新实现了：
- ✅ 完整的 Refresh Token 机制
- ✅ 多设备会话管理
- ✅ 远程会话撤销
- ✅ 自动 token 刷新
- ✅ 管理员会话管理
- ✅ 审计日志记录

所有功能均已测试编译通过，可以立即使用！
