<div align="center">

# 🔐 IDP Center

**安全、标准、易用的独立身份认证中心**

支持 OAuth 2.1 / OIDC · OTP 双因素认证 · 多租户隔离 · 管理后台

[![TypeScript](https://img.shields.io/badge/TypeScript-5.8-blue.svg)](https://www.typescriptlang.org/)
[![React](https://img.shields.io/badge/React-19-61dafb.svg)](https://react.dev/)
[![Express](https://img.shields.io/badge/Express-4-000000.svg)](https://expressjs.com/)
[![SQLite](https://img.shields.io/badge/SQLite-003B57.svg)](https://www.sqlite.org/)
[![Vitest](https://img.shields.io/badge/Tests-352%20passed-brightgreen.svg)](https://vitest.dev/)

</div>

---

## ✨ 核心功能

### 🔑 认证能力
- **用户认证** — 注册、登录、登出、密码重置
- **邮箱验证** — 注册后邮箱验证、验证邮件重发
- **OTP 双因素认证** — 基于 TOTP 的 2FA（兼容 Google Authenticator）
- **GitHub OAuth** — 第三方社交登录
- **JWT 令牌** — Access Token + Refresh Token 机制
- **密码策略** — 强密码校验、历史密码限制、密码过期轮换

### 🏢 企业级特性
- **多租户隔离** — 租户级数据隔离与配置
- **IP 白名单** — 租户级网络访问控制（支持 IPv4/IPv6 CIDR）
- **审计日志** — 全链路操作审计与导出
- **会话管理** — 全局会话查看与强制下线

### 📡 协议支持
- **OpenID Connect (OIDC)** — 标准 OIDC Provider
- **OAuth 2.1** — 授权码流程 + PKCE
- **JWKS** — JSON Web Key Set 端点
- **动态发现** — `.well-known/openid-configuration`

### 🛡️ 安全防护
- **登录防暴破** — 失败次数锁定（可配置）
- **密码加密** — bcrypt 哈希
- **Helmet** — HTTP 安全头
- **Token 黑名单** — JWT 吊销机制

---

## 🏗️ 技术栈

| 层级 | 技术 |
|------|------|
| **前端** | React 19 + Vite + TanStack Router + Tailwind CSS 4 |
| **后端** | Express 4 + TypeScript 5.8 |
| **数据库** | better-sqlite3（本地文件 `auth.db`） |
| **测试** | Vitest + Supertest + fast-check（属性测试） |
| **构建** | Vite（前端）+ tsc（后端） |

---

## 📁 项目结构

```
idp-center/
├── src/                    # 前端源码
│   ├── pages/              # 页面组件
│   │   ├── Login.tsx       # 登录页
│   │   ├── Register.tsx    # 注册页
│   │   ├── Profile.tsx     # 用户资料
│   │   ├── Dashboard.tsx   # 仪表盘
│   │   ├── Authorize.tsx   # OAuth 授权页
│   │   ├── ForgotPassword.tsx
│   │   ├── ResetPassword.tsx
│   │   ├── VerifyEmail.tsx
│   │   ├── SetupOTP.tsx    # OTP 设置
│   │   └── admin/          # 管理后台页面
│   ├── routes/             # TanStack Router 路由定义
│   ├── utils/              # 工具函数（fetch 封装等）
│   └── App.tsx             # 应用入口
├── server/                 # 后端源码
│   ├── routes/             # API 路由
│   │   ├── auth.ts         # 认证相关
│   │   ├── oidc.ts         # OIDC/OAuth
│   │   ├── github.ts       # GitHub OAuth
│   │   ├── user.ts         # 用户操作
│   │   └── admin.ts        # 管理后台
│   ├── services/           # 业务服务
│   ├── middleware/          # 中间件（认证、校验）
│   ├── validators/         # Zod 参数校验
│   ├── utils/              # 工具函数
│   └── database.ts         # 数据库迁移与种子
├── server.ts               # 服务入口
├── email-templates.ts      # 邮件模板
├── tests/                  # 测试文件
└── example/                # Vue 接入示例（独立应用）
```

---

## 🚀 快速开始

### 环境要求

- Node.js >= 18
- pnpm

### 安装与运行

```bash
# 1. 安装依赖
pnpm install

# 2. 配置环境变量
cp .env.example .env
# 编辑 .env 填入实际配置

# 3. 启动开发服务器
pnpm dev
```

访问 http://localhost:5986

### 默认账号（仅开发环境）

| 角色 | 用户名 | 密码 |
|------|--------|------|
| 管理员 | `admin` | `Admin@IdpCenter2024!` |

> ⚠️ 生产环境请立即修改默认密码

### 默认 OAuth 客户端

| 字段 | 值 |
|------|-----|
| client_id | `default-client` |
| client_secret | `secret123` |

---

## ⚙️ 环境变量

在 `.env` 文件中配置（参考 `.env.example`）：

| 变量 | 必需 | 说明 |
|------|------|------|
| `APP_URL` | ✅ | 应用访问地址，用于 OAuth 回调、邮件链接 |
| `JWT_SECRET` | ✅ | JWT 签名密钥（至少 32 字符） |
| `JWT_REFRESH_SECRET` | ✅ | Refresh Token 密钥（至少 32 字符） |
| `SMTP_HOST` | ✅ | SMTP 服务器地址 |
| `SMTP_PORT` | ✅ | SMTP 端口 |
| `SMTP_USER` | ✅ | SMTP 用户名 |
| `SMTP_PASS` | ✅ | SMTP 密码 |
| `SMTP_FROM` | ✅ | 发件人地址 |
| `GITHUB_CLIENT_ID` | ❌ | GitHub OAuth Client ID |
| `GITHUB_CLIENT_SECRET` | ❌ | GitHub OAuth Client Secret |
| `GITHUB_CALLBACK_URL` | ❌ | GitHub 回调地址（默认自动推断） |
| `ENCRYPTION_KEY` | ❌ | 加密密钥（至少 32 字符） |
| `DB_PATH` | ❌ | 数据库路径（默认 `auth.db`） |
| `JWT_EXPIRES_IN` | ❌ | Token 过期时间（默认 `1h`） |

---

## 🔧 GitHub OAuth 配置

### 1. 创建 GitHub OAuth App

1. 打开 GitHub → **Settings** → **Developer settings** → **OAuth Apps** → **New OAuth App**
2. 填写以下信息：
   - **Application name**：如 `IdP Center`
   - **Homepage URL**：`http://localhost:5986`（生产环境改为实际域名）
   - **Authorization callback URL**：`http://localhost:5986/api/auth/github/callback`
3. 点击 **Register application**
4. 复制 **Client ID**，点击 **Generate a new client secret** 并复制

### 2. 配置环境变量

```env
GITHUB_CLIENT_ID=your_client_id_here
GITHUB_CLIENT_SECRET=your_client_secret_here

# 可选，默认值为 http://localhost:5986/api/auth/github/callback
# GITHUB_CALLBACK_URL=https://yourdomain.com/api/auth/github/callback
```

### 3. 生产环境部署

1. 将 `GITHUB_CALLBACK_URL` 改为实际域名：
   ```env
   GITHUB_CALLBACK_URL=https://yourdomain.com/api/auth/github/callback
   ```
2. 同步更新 GitHub OAuth App 设置中的 **Authorization callback URL**

> 未配置 `GITHUB_CLIENT_ID` / `GITHUB_CLIENT_SECRET` 时，登录页不会显示 GitHub 登录按钮，功能自动禁用。

---

## 📡 API 概览

### 认证接口 `/api/auth`

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/register` | 用户注册 |
| POST | `/login` | 用户登录 |
| POST | `/logout` | 用户登出 |
| POST | `/refresh` | 刷新 Token |
| GET | `/me` | 获取当前用户信息 |
| POST | `/otp/setup` | 设置 OTP |
| POST | `/otp/verify` | 验证 OTP |
| POST | `/email/verify` | 验证邮箱 |
| POST | `/email/resend` | 重发验证邮件 |
| POST | `/password/reset-request` | 请求密码重置 |
| POST | `/password/reset` | 执行密码重置 |
| POST | `/password/change-expired` | 修改过期密码 |
| POST | `/password/validate` | 校验密码强度 |

### OIDC 接口 `/api/oidc`

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/.well-known/openid-configuration` | OIDC 发现端点 |
| GET | `/.well-known/jwks.json` | JWKS 端点 |
| GET | `/authorize` | 授权端点 |
| POST | `/token` | Token 端点 |
| GET | `/userinfo` | UserInfo 端点 |

### GitHub OAuth `/api/auth/github`

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/config` | 获取 GitHub OAuth 配置 |
| GET | `/` | 发起 GitHub 登录 |
| GET | `/callback` | GitHub 回调 |
| POST | `/exchange` | 交换 Token |

### 管理接口 `/api/admin`

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/users` | 用户列表 |
| POST | `/users` | 创建用户 |
| PUT | `/users/:id` | 更新用户 |
| DELETE | `/users/:id` | 删除用户 |
| POST | `/users/:id/ban` | 封禁用户 |
| POST | `/users/:id/unban` | 解封用户 |
| GET | `/clients` | 客户端列表 |
| POST | `/clients` | 创建客户端 |
| PUT | `/clients/:id` | 更新客户端 |
| DELETE | `/clients/:id` | 删除客户端 |
| POST | `/clients/:id/rotate-secret` | 轮换客户端密钥 |
| GET | `/tenants` | 租户列表 |
| POST | `/tenants` | 创建租户 |
| GET | `/sessions` | 会话列表 |
| GET | `/audit` | 审计日志 |
| GET | `/stats` | 系统统计 |

---

## 🧪 测试

```bash
# 运行所有测试
pnpm test

# 类型检查
pnpm lint

# 构建
pnpm build
```

测试覆盖：352 个测试用例，包括：
- 单元测试（验证器、工具函数、服务）
- 集成测试（API 端点）
- 属性测试（fast-check 用于密码策略等）

---

## 🐳 Docker 部署

### 构建镜像

```bash
docker build -t idp-center .
```

### 多架构构建（适用于 Apple Silicon 和 x86_64）

```bash
docker buildx build --platform linux/amd64,linux/arm64 -t idp-center:latest --push .
```

### 运行容器

```bash
docker run -d \
  --name idp-center \
  -p 5986:5986 \
  -v $(pwd)/auth.db:/app/auth.db \
  idp-center
```

---

## 📚 示例应用

`example/` 目录包含一个 Vue 3 接入示例，演示如何对接 IDP Center 的认证能力：

```bash
cd example
pnpm install
pnpm dev
```

---

## 📄 许可证

MIT
