# IDP Center Vue Demo

这是一个演示如何将 Vue 应用与 IDP Center 账号中心对接的示例项目。

## 功能特性

- ✅ **直接登录**: 使用用户名密码登录
- ✅ **用户注册**: 创建新用户账号
- ✅ **OAuth2 授权码流程**: 完整的 OAuth2 Authorization Code Flow
- ✅ **用户信息展示**: 显示用户信息和 JWT Token 详情
- ✅ **个人资料管理**: 更新用户个人信息

## 技术栈

- Vue 3 + TypeScript
- Vue Router
- Pinia (状态管理)
- Vite

## 快速开始

### 1. 安装依赖

```bash
cd example
npm install
# 或
pnpm install
```

### 2. 启动 IDP Center

确保 IDP Center 在 http://localhost:5986 运行：

```bash
# 在项目根目录
pnpm dev
```

### 3. 启动 Demo 应用

```bash
# 在 example 目录
pnpm dev
```

应用将在 http://localhost:3000 启动。

## 认证方式

### 方式 1: 直接登录

直接使用用户名和密码登录：

```typescript
// 调用登录 API
const response = await fetch('/api/auth/login', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ username, password })
})

const { token, user } = await response.json()

// 保存 token
localStorage.setItem('token', token)

// 后续请求携带 token
fetch('/api/auth/me', {
  headers: { 'Authorization': `Bearer ${token}` }
})
```

### 方式 2: OAuth2 授权码流程

**步骤 1**: 重定向到授权页面

```typescript
const params = new URLSearchParams({
  client_id: 'default-client',
  redirect_uri: 'http://localhost:3000/callback',
  response_type: 'code',
  scope: 'openid profile email',
  state: 'random-state-string'
})

window.location.href = `http://localhost:5986/authorize?${params.toString()}`
```

**步骤 2**: 用户授权后，处理回调

```typescript
// 在 callback 页面获取授权码
const code = route.query.code
const state = route.query.state

// 验证 state（防止 CSRF）
if (state !== savedState) {
  throw new Error('Invalid state')
}

// 用授权码换取 access token
const response = await fetch('/api/oidc/token', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    grant_type: 'authorization_code',
    code,
    client_id: 'default-client',
    client_secret: 'secret123',
    redirect_uri: 'http://localhost:3000/callback'
  })
})

const { access_token, id_token } = await response.json()
```

**步骤 3**: 使用 access token 获取用户信息

```typescript
const response = await fetch('/api/oidc/userinfo', {
  headers: { 'Authorization': `Bearer ${access_token}` }
})

const userInfo = await response.json()
// { sub: 'user-id', name: 'username', email: 'user@email.com' }
```

## API 端点

### 认证相关

| 端点 | 方法 | 说明 |
|------|------|------|
| `/api/auth/register` | POST | 用户注册 |
| `/api/auth/login` | POST | 用户登录 |
| `/api/auth/me` | GET | 获取当前用户信息 |
| `/api/auth/refresh` | POST | 刷新 token |

### OAuth2/OIDC

| 端点 | 方法 | 说明 |
|------|------|------|
| `/api/oidc/authorize` | GET | 授权页面 |
| `/api/oidc/authorize` | POST | 确认授权 |
| `/api/oidc/token` | POST | 获取 token |
| `/api/oidc/userinfo` | GET | 获取用户信息 |

### 用户管理

| 端点 | 方法 | 说明 |
|------|------|------|
| `/api/user/profile` | PUT | 更新个人资料 |
| `/api/user/password` | PUT | 修改密码 |
| `/api/user/sessions` | GET | 获取登录会话 |

## 项目结构

```
example/
├── src/
│   ├── components/      # 公共组件
│   │   └── AppHeader.vue
│   ├── views/           # 页面组件
│   │   ├── Home.vue      # 首页
│   │   ├── Login.vue     # 登录页
│   │   ├── Register.vue  # 注册页
│   │   ├── Callback.vue  # OAuth 回调页
│   │   ├── Dashboard.vue # 控制台
│   │   └── Profile.vue   # 个人资料
│   ├── stores/          # Pinia 状态管理
│   │   └── auth.ts       # 认证状态
│   ├── router/          # 路由配置
│   │   └── index.ts
│   ├── App.vue          # 根组件
│   ├── main.ts          # 入口文件
│   └── style.css        # 全局样式
├── index.html
├── vite.config.ts       # Vite 配置
├── tsconfig.json        # TypeScript 配置
├── package.json
└── README.md
```

## 默认账号

- **用户名**: admin
- **密码**: admin123

## 配置说明

### Vite 代理配置

`vite.config.ts` 中配置了代理，将 `/api` 请求转发到 IDP Center：

```typescript
export default defineConfig({
  server: {
    port: 3000,
    proxy: {
      '/api': {
        target: 'http://localhost:5986',
        changeOrigin: true
      }
    }
  }
})
```

### OAuth 客户端配置

在 IDP Center 中配置的默认客户端：

- **Client ID**: `default-client`
- **Client Secret**: `secret123`
- **Redirect URI**: `http://localhost:3000/callback`

## 安全建议

1. **生产环境必须使用 HTTPS**
2. **Token 存储**: 推荐使用 httpOnly cookies 而不是 localStorage
3. **实现 Token 刷新机制**
4. **验证 JWT 签名**
5. **使用 state 参数防止 CSRF 攻击**
6. **实施速率限制和账户锁定策略**

## 扩展功能

IDP Center 还支持：

- 🔐 两步验证 (OTP/TOTP)
- 🏢 多租户管理
- 📊 审计日志
- 🔄 Token 刷新
- 📧 密码重置

详细文档请参考 IDP Center 主项目。

## License

MIT
