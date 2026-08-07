# IDP Center Vue Demo

这是一个演示如何将 Vue 应用与 IDP Center 账号中心对接的示例项目，独立于主应用维护（不是主应用前端的子模块）。

> 本文档随主应用阶段一~四的实施同步更新（2026-08）：登录流程已适配 MFA（`403 AUTH_MFA_REQUIRED` + 因子选择/验证码）、OAuth2 演示客户端的 secret 改为环境变量配置（主应用不再有固定的 `secret123`）。

## 功能特性

- ✅ **直接登录**：用户名密码登录，支持 TOTP/Email/SMS 多因子二次验证
- ✅ **用户注册**：创建新用户账号
- ✅ **OAuth2 / OIDC 授权码流程**：完整的 Authorization Code + PKCE(S256) Flow
- ✅ **用户信息展示**：显示用户信息和 Token 详情
- ✅ **个人资料管理**：更新用户个人信息、会话管理、可信设备管理
- ✅ **密码重置 / 邮箱验证**：完整的自助流程

## 技术栈

- Vue 3 + TypeScript
- Vue Router
- Pinia（状态管理）
- Vite

## 快速开始

### 1. 启动 IDP Center 主应用

主应用现在需要 PostgreSQL（不再是 SQLite），详见根目录 [README.md](../README.md)：

```bash
# 在项目根目录，起本地 PostgreSQL（如果还没有）
docker run -d -p 5432:5432 -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=idp_center postgres:16

pnpm install
cp .env.example .env   # 至少配置 JWT_SECRET / SMTP_* / PG_*
pnpm dev
```

首次启动会在控制台打印随机生成的管理员密码和默认 OAuth 客户端（`default-client`）的 secret ——**记下这个 secret**，下一步要用。

### 2. 配置 Demo 应用

```bash
cd example
cp .env.example .env
```

编辑 `.env`，把 `VITE_CLIENT_SECRET` 换成上一步控制台打印的值：

```env
VITE_IDP_CENTER_URL=http://localhost:5986
VITE_CLIENT_ID=default-client
VITE_CLIENT_SECRET=<从主应用控制台复制>
VITE_REDIRECT_URI=http://localhost:3000/callback
```

只走「用户名密码登录」（首页 Login 表单）不需要这一步；只有点击「Single Sign-On (SSO)」触发的 OAuth2 授权码流程才需要 `VITE_CLIENT_SECRET`。

### 3. 安装依赖并启动

```bash
pnpm install
pnpm dev
```

应用将在 http://localhost:3000 启动。

## 认证方式

### 方式 1：直接登录（含 MFA）

```typescript
// src/stores/auth.ts
const ok = await authStore.login(username, password)
```

如果账号启用了 MFA，`login()` 不会直接返回 token，而是抛出 `MfaRequiredError`（对应服务端 `403 AUTH_MFA_REQUIRED`），携带 `mfaToken` 与 `factors` 列表：

```typescript
import { MfaRequiredError } from '../stores/auth'

try {
  await authStore.login(username, password)
} catch (err) {
  if (err instanceof MfaRequiredError) {
    // err.factors: [{ id, type: 'totp'|'email'|'sms'|'webauthn', name }]
    // email/sms 需要先发码：
    await authStore.mfaChallenge(err.mfaToken, factorId)
    // 再验证（totp/recovery 可以跳过上一步直接验证）：
    await authStore.mfaVerify(err.mfaToken, factorId, code)
  }
}
```

完整实现见 [`src/views/Login.vue`](src/views/Login.vue)。本 Demo 未实现 WebAuthn 的浏览器 ceremony，选中该类型因子会提示改用主应用 UI。

### 方式 2：OAuth2 / OIDC 授权码流程（PKCE）

```typescript
// 触发登录（生成 state + PKCE，跳转主应用 /#/authorize）
await authStore.beginOAuthLogin('/dashboard')

// Callback.vue 里换取 token（state 校验 + code_verifier 都由 store 处理）
await authStore.exchangeCodeForToken(code, verifier)
```

`client_id` / `client_secret` / `redirect_uri` 统一从 [`src/config.ts`](src/config.ts) 读取（来自 `.env`），不要在组件里再写死。

### 方式 3：获取用户信息

```typescript
const response = await fetch('/api/oidc/userinfo', {
  headers: { Authorization: `Bearer ${access_token}` }
})
const userInfo = await response.json()
// { sub: 'user-id', name: 'username', email: 'user@email.com' }
```

## API 端点（节选）

完整列表以主应用 [`server/routes/`](../server/routes) 为准，本 Demo 用到的部分：

### 认证相关 `/api/auth`

| 端点 | 方法 | 说明 |
|------|------|------|
| `/register` | POST | 用户注册 |
| `/login` | POST | 用户登录；MFA 账号返回 `403 AUTH_MFA_REQUIRED` |
| `/mfa/challenge` | POST | 为 email/sms 因子发送一次性验证码 |
| `/mfa/verify` | POST | 校验第二因子并完成登录 |
| `/me` | GET | 获取当前用户信息 |
| `/refresh` | POST | 刷新 token |
| `/otp/setup`、`/otp/verify` | POST | 启用 TOTP（兼容旧字段，内部落到统一的 MFA 因子表） |
| `/password/reset-request`、`/password/reset` | POST | 密码重置 |
| `/email/verify`、`/email/resend*` | POST | 邮箱验证 |

### OAuth2/OIDC `/api/oidc`

| 端点 | 方法 | 说明 |
|------|------|------|
| `/authorize` | GET/POST | 授权页面（主应用是 hash 路由，实际地址是 `/#/authorize`） |
| `/token` | POST | 获取 token（`grant_type=authorization_code` + PKCE） |
| `/userinfo` | GET | 获取用户信息 |

### 用户管理 `/api/user`

| 端点 | 方法 | 说明 |
|------|------|------|
| `/profile` | PUT | 更新个人资料 |
| `/password` | PUT | 修改密码 |
| `/sessions` | GET/DELETE | 会话列表 / 远程下线 |
| `/trusted-devices` | GET/DELETE | 可信设备列表 / 撤销 |

## 项目结构

```
example/
├── src/
│   ├── config.ts         # OAuth 客户端配置（读取 .env），唯一事实来源
│   ├── components/
│   │   └── AppHeader.vue
│   ├── views/
│   │   ├── Home.vue          # 首页
│   │   ├── Login.vue         # 登录页（含 MFA 因子选择/验证）
│   │   ├── Register.vue      # 注册页
│   │   ├── Callback.vue      # OAuth 回调页
│   │   ├── Dashboard.vue     # 控制台
│   │   ├── Profile.vue       # 个人资料
│   │   ├── Sessions.vue      # 会话管理
│   │   ├── SetupOTP.vue      # 启用 TOTP
│   │   ├── ForgotPassword.vue / ResetPassword.vue
│   │   └── VerifyEmail.vue
│   ├── stores/auth.ts    # 认证状态：登录/MFA/OAuth/会话/密码重置等
│   ├── router/index.ts
│   ├── utils/http.ts     # axios 封装（自动刷新 token）
│   ├── App.vue
│   └── main.ts
├── .env.example
├── index.html
├── vite.config.ts        # /api 代理到 VITE_IDP_CENTER_URL
├── tsconfig.json
└── package.json
```

## 默认账号

主应用不再提供固定的默认密码——管理员密码和 `default-client` 的 secret 都是首次启动时随机生成并打印在**主应用**控制台。如果只是想跑通 Demo，直接在本 Demo 的注册页创建一个新账号即可，不需要管理员权限。

## 配置说明

### Vite 代理配置

`vite.config.ts` 把 `/api` 请求代理到 `VITE_IDP_CENTER_URL`（默认 `http://localhost:5986`）：

```typescript
export default defineConfig({
  server: {
    port: 3000,
    proxy: {
      '/api': { target: 'http://localhost:5986', changeOrigin: true }
    }
  }
})
```

### OAuth 客户端配置

默认使用主应用自动播种的 `default-client`（重定向地址需要与主应用 `clients` 表里配置的一致，默认包含 `http://localhost:3000/callback`）。secret 见上方「配置 Demo 应用」一节。

## 安全建议

1. 生产环境必须使用 HTTPS
2. Token 存储：本 Demo 用 `localStorage` 便于演示，生产场景推荐 httpOnly cookies
3. 已实现 Token 自动刷新（`src/utils/http.ts` 的响应拦截器）
4. 已实现 PKCE(S256) 防止授权码拦截攻击
5. 已用 `state` 参数防止 CSRF，且校验一次性消费（`consumeOAuthState`）
6. 生产环境请配置速率限制（主应用已内置，见根目录 [docs/operations/deployment.md](../docs/operations/deployment.md)）和账户锁定策略（已内置）

## 扩展功能（本 Demo 未演示，主应用已支持）

- 🔐 WebAuthn/FIDO2、恢复码
- 🏢 SAML/OIDC/LDAP 联合身份、SCIM 2.0
- 📊 风险引擎（自适应认证）、审计日志导出
- 🔄 设备码流程（RFC 8628）、令牌内省/撤销

详见根目录 [README.md](../README.md) 与 [ENTERPRISE-OAUTH-IMPLEMENTATION-PLAN.md](../ENTERPRISE-OAUTH-IMPLEMENTATION-PLAN.md)。

## License

MIT
