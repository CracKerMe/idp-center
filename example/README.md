# IDP Center Vue Demo

这是一个演示如何将 Vue 应用与 IDP Center 账号中心对接的示例项目，独立于主应用维护（不是主应用前端的子模块）。

> 本文档随主应用阶段一~四的实施同步更新（2026-08）：登录流程已适配 MFA（`403 AUTH_MFA_REQUIRED` + 因子选择/验证码，含 WebAuthn/恢复码）、新增 MFA 因子管理、SSO 联合登录（SAML/OIDC 跳转 + LDAP 表单）、OAuth2 设备码流程（RFC 8628）、Token 内省/撤销（RFC 7662/7009）演示；OAuth2 演示客户端的 secret 改为环境变量配置（主应用不再有固定的 `secret123`）。

## 功能特性

- ✅ **直接登录**：用户名密码登录，支持 TOTP/Email/SMS/WebAuthn 多因子二次验证 + 恢复码兜底
- ✅ **用户注册**：创建新用户账号
- ✅ **MFA 因子管理**：启用/禁用 TOTP、Email 验证码、WebAuthn 安全密钥，生成恢复码（[`MfaFactors.vue`](src/views/MfaFactors.vue)）
- ✅ **SSO 联合登录**：发现已启用的 IdP（`GET /api/auth/idps`），SAML/OIDC 走跳转登录，LDAP 走本demo内的表单直登（[`SsoProviderButtons.vue`](src/components/SsoProviderButtons.vue)）
- ✅ **OAuth2 / OIDC 授权码流程**：完整的 Authorization Code + PKCE(S256) Flow
- ✅ **OAuth2 设备码流程（RFC 8628）**：模拟无浏览器设备发起登录 + 已登录会话扫码授权两端（[`DeviceLogin.vue`](src/views/DeviceLogin.vue) / [`DeviceApprove.vue`](src/views/DeviceApprove.vue)）
- ✅ **Token 内省 / 撤销（RFC 7662 / RFC 7009）**：Dashboard 内查看当前 access token 的服务端状态，一键撤销强制下线
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
    // email/sms 需要先发码；webauthn 的 challenge 会返回断言 options：
    const challenge = await authStore.mfaChallenge(err.mfaToken, factorId)
    // totp/email/sms/recovery 用验证码完成：
    await authStore.mfaVerify(err.mfaToken, factorId, { code })
    // webauthn 用 @simplewebauthn/browser 的 startAuthentication 拿到断言后完成：
    const assertion = await startAuthentication({ optionsJSON: challenge.options })
    await authStore.mfaVerify(err.mfaToken, factorId, { response: assertion })
    // 没有其他因子可用时，也可以直接用恢复码（不需要 factorId）：
    await authStore.mfaVerify(err.mfaToken, null, { code: recoveryCode })
  }
}
```

完整实现见 [`src/views/Login.vue`](src/views/Login.vue)（含 WebAuthn 浏览器 ceremony 与恢复码兜底）。因子的启用/停用见 [`src/views/MfaFactors.vue`](src/views/MfaFactors.vue)。

### 方式 2：OAuth2 / OIDC 授权码流程（PKCE）

```typescript
// 触发登录（生成 state + PKCE，跳转主应用 /authorize）
await authStore.beginOAuthLogin('/dashboard')

// Callback.vue 里换取 token（state 校验 + code_verifier 都由 store 处理）
await authStore.exchangeCodeForToken(code, verifier)
```

`client_id` / `client_secret` / `redirect_uri` 统一从 [`src/config.ts`](src/config.ts) 读取（来自 `.env`），不要在组件里再写死。

### 方式 2b：OAuth2 设备码流程（RFC 8628）

```typescript
// "设备"端（无浏览器场景，/device-flow）：拿到 user_code，轮询直到用户批准
const { device_code, user_code, verification_uri_complete, interval } = await authStore.startDeviceAuthorization()
const result = await authStore.pollDeviceToken(device_code) // 'pending' | 'slow_down' | 'approved' | 'denied' | 'expired'

// "批准"端（已登录会话，/device）：核对 client_name/scope 后批准或拒绝
const { client_name, scope } = await authStore.deviceVerify(userCode)
await authStore.deviceApprove(userCode) // 或 authStore.deviceDeny(userCode)
```

完整实现见 [`src/views/DeviceLogin.vue`](src/views/DeviceLogin.vue) 和 [`src/views/DeviceApprove.vue`](src/views/DeviceApprove.vue)。

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
| `/mfa/challenge` | POST | 为 email/sms 因子发一次性验证码，为 webauthn 因子取断言 options |
| `/mfa/verify` | POST | 校验第二因子（含 webauthn 断言 / 恢复码）并完成登录 |
| `/idps` | GET | 发现已启用的联合身份提供方（SAML/OIDC/LDAP），驱动 SSO 按钮列表 |
| `/federation/exchange` | POST | SAML/OIDC 跳转登录回调后，一次性 code 换 token（落地页在主应用） |
| `/me` | GET | 获取当前用户信息 |
| `/refresh` | POST | 刷新 token |
| `/otp/setup`、`/otp/verify` | POST | 启用 TOTP（兼容旧字段，内部落到统一的 MFA 因子表） |
| `/password/reset-request`、`/password/reset` | POST | 密码重置 |
| `/email/verify`、`/email/resend*` | POST | 邮箱验证 |

### MFA 因子管理 `/api/user/mfa`（认证后）

| 端点 | 方法 | 说明 |
|------|------|------|
| `/factors` | GET | 已启用因子列表 + 剩余恢复码数 |
| `/totp/setup`、`/totp/verify` | POST | 启用 Authenticator App |
| `/email/setup`、`/email/verify` | POST | 启用 Email 验证码因子 |
| `/webauthn/register/options`、`/webauthn/register/verify` | POST | 注册安全密钥（`@simplewebauthn/browser` 的 `startRegistration`） |
| `/recovery/generate` | POST | 生成一次性恢复码（需已有其他因子） |
| `/factors/:id` | DELETE | 停用因子（需密码二次确认） |

### 联合登录 `/api/federation`

| 端点 | 方法 | 说明 |
|------|------|------|
| `/:alias/saml/login`、`/:alias/oidc/login` | GET | 跳转到外部 IdP；回调只认主应用自身 origin，跳转登录完成后落地在**主应用**，不是本 Demo |
| `/:alias/ldap/login` | POST | 同页表单直登，本 Demo 内可完整走通（无跳转） |

### OAuth2/OIDC `/api/oidc`

| 端点 | 方法 | 说明 |
|------|------|------|
| `/authorize` | GET/POST | 授权页面（主应用使用 history 路由，地址即为 `/authorize`） |
| `/token` | POST | 获取 token；`grant_type=authorization_code`（PKCE）或 `urn:ietf:params:oauth:grant-type:device_code`（设备码轮询） |
| `/userinfo` | GET | 获取用户信息 |
| `/device_authorization` | POST | 设备码流程第一步：client 认证 + scope，换 `device_code`/`user_code` |
| `/device/verify` | GET | （已登录会话）查询 `user_code` 对应的请求方客户端和 scope |
| `/device/approve`、`/device/deny` | POST | （已登录会话）批准/拒绝设备登录请求 |
| `/introspect` | POST | RFC 7662 token 内省，需 client_id/secret |
| `/revoke` | POST | RFC 7009 token 撤销，需 client_id/secret；撤销 refresh token 会级联撤销同 session 下所有 access token |

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
│   │   ├── AppHeader.vue
│   │   └── SsoProviderButtons.vue   # SAML/OIDC 跳转按钮 + LDAP 内联表单
│   ├── views/
│   │   ├── Home.vue          # 首页
│   │   ├── Login.vue         # 登录页（含 MFA 因子选择/验证、WebAuthn、恢复码、SSO）
│   │   ├── Register.vue      # 注册页
│   │   ├── Callback.vue      # OAuth 授权码回调页
│   │   ├── Dashboard.vue     # 控制台（含 Token 内省/撤销面板）
│   │   ├── Profile.vue       # 个人资料
│   │   ├── Sessions.vue      # 会话 / 可信设备管理
│   │   ├── MfaFactors.vue    # MFA 因子管理（TOTP/Email/WebAuthn/恢复码）
│   │   ├── DeviceLogin.vue   # 设备码流程：模拟无浏览器设备发起 + 轮询
│   │   ├── DeviceApprove.vue # 设备码流程：已登录会话批准/拒绝
│   │   ├── SetupOTP.vue      # 启用 TOTP（旧版单因子入口，保留兼容）
│   │   ├── ForgotPassword.vue / ResetPassword.vue
│   │   └── VerifyEmail.vue
│   ├── stores/auth.ts    # 认证状态：登录/MFA/WebAuthn/联合登录/设备码/Token内省撤销/会话等
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

## SSO 联合登录的已知限制

SAML/OIDC 的回调地址固定为主应用自身 origin（`server/routes/federation/{saml,oidc-rp}.ts` 只允许同源相对路径的 `redirect`），完成第三方 IdP 登录后浏览器会落地在**主应用**而不是这个独立部署的 Demo（端口 3000）。因此：

- SAML/OIDC 按钮会正确发起跳转，演示"点击后进入外部 IdP 登录页"这一步，但登录成功后不会跳回本 Demo；
- **LDAP** 是同页表单直接 POST，没有跳转，本 Demo 内可以完整走通。

这不是本 Demo 未实现，而是后端当前的架构约束——SP 与 IdP 前端目前是同一个部署。若要让独立子域的客户端应用完整跑通 SAML/OIDC 联合登录，需要后端支持跨源 `redirect_uri` 白名单（类似 OAuth 客户端的 `redirect_uris` 校验）。

## 有意不演示的能力（管理侧 / 服务器到服务器，不适合放进终端用户 Demo）

- 🏢 **SCIM 2.0**（`/scim/v2/*`）：IdP 侧用 `client_credentials` 拉取/推送用户和组的服务器到服务器协议，从不经过浏览器会话，没有"终端用户登录 Demo"里能演示的入口。
- 📊 **风险引擎（自适应认证）**：`server/services/risk.service.ts` 在每次密码登录时打分，但对客户端暴露的效果只是"直接放行"或"升级成普通的 `403 AUTH_MFA_REQUIRED`"——协议层面和本 Demo 已实现的 MFA 流程没有区别，没有独立 UI 可做。管理侧策略配置和事件面板见 `server/routes/admin/risk.ts`（`authenticateAdmin`）。
- 📁 **审计日志导出**（`/api/admin/audit/*`）：需要管理员权限，本 Demo 定位是普通终端用户客户端，不请求管理员令牌。
- ⚙️ **IdP 联合身份的管理端配置**（`/api/admin/idps/*`）：新增/编辑 SAML/OIDC/LDAP 提供方是管理员操作，本 Demo 只消费已配置好的 IdP 列表（`GET /api/auth/idps`），不做配置界面。

详见根目录 [README.md](../README.md) 与 [ENTERPRISE-OAUTH-IMPLEMENTATION-PLAN.md](../ENTERPRISE-OAUTH-IMPLEMENTATION-PLAN.md)。

## License

MIT
