# 🚀 IDP Center 启动帮助文档

> 本文档面向首次接触项目的开发者，提供从零到运行的完整指引。日常快速参考请看 [README.md](README.md)。

---

## 📋 目录

- [环境要求](#环境要求)
- [快速启动（5 分钟）](#快速启动5-分钟)
- [环境变量详解](#环境变量详解)
- [数据库管理](#数据库管理)
- [开发工作流](#开发工作流)
- [测试](#测试)
- [Docker 部署](#docker-部署)
- [示例应用](#示例应用)
- [常见问题排查](#常见问题排查)
- [相关文档](#相关文档)

---

## 环境要求

| 依赖 | 最低版本 | 说明 |
|------|----------|------|
| **Node.js** | >= 18 | 推荐 LTS（当前验证 22.x） |
| **pnpm** | >= 8 | 包管理器 |
| **PostgreSQL** | >= 16 | 主数据库（本地推荐 Docker 起） |
| **Docker**（可选） | >= 24 | 用于起 PostgreSQL 或构建镜像 |

> 💡 Redis、GeoIP、Anthropic API 均为可选依赖，未配置时功能自动降级，不影响核心认证流程。

---

## 快速启动（5 分钟）

### 第 1 步：起 PostgreSQL

```bash
# 使用 Docker 起一个本地 PostgreSQL 实例
docker run -d \
  --name idp-pg \
  -p 5432:5432 \
  -e POSTGRES_PASSWORD=postgres \
  -e POSTGRES_DB=idp_center \
  postgres:16
```

### 第 2 步：安装依赖

```bash
cd idp-center
pnpm install
```

### 第 3 步：配置环境变量

```bash
cp .env.example .env
```

编辑 `.env`，**必须修改**以下变量：

```env
# JWT 签名密钥（>= 32 字符，生产环境务必更换）
JWT_SECRET="your-super-secret-jwt-key-at-least-32chars"

# SMTP 邮件配置（用于验证邮件、密码重置、Email OTP）
SMTP_HOST="smtp.example.com"
SMTP_PORT=587
SMTP_USER="your-smtp-username"
SMTP_PASS="your-smtp-password"
SMTP_FROM="noreply@yourdomain.com"

# 数据库连接（如果 Docker 按上面方式启动，保持默认即可）
PG_HOST="localhost"
PG_PORT=5432
PG_USER="postgres"
PG_PASSWORD="postgres"
PG_DATABASE="idp_center"
```

> 💡 也可以使用 `DATABASE_URL` 替代分立的 `PG_*` 变量：
> ```env
> DATABASE_URL="postgresql://postgres:postgres@localhost:5432/idp_center"
> ```

### 第 4 步：启动开发服务器

```bash
pnpm dev
```

首次启动时，系统会自动：
1. 通过 `drizzle-kit push` 创建数据库表结构
2. 播种默认数据（默认租户 `default`）
3. 生成默认管理员账号（用户名 `admin`，密码随机打印在控制台）
4. 生成默认 OAuth 客户端（`client_id = default-client`，secret 打印在控制台）

### 第 5 步：访问应用

- **前端**：http://localhost:5986
- **管理后台**：http://localhost:5986 → 使用 `admin` + 控制台打印的密码登录
- **健康检查**：http://localhost:5986/livez
- **Prometheus 指标**：http://localhost:5986/metrics
- **OIDC 发现**：http://localhost:5986/.well-known/openid-configuration
- **JWKS**：http://localhost:5986/.well-known/jwks.json

> ⚠️ 首次登录后系统会强制要求修改管理员密码。

---

## 环境变量详解

### 必需变量

| 变量 | 说明 | 示例 |
|------|------|------|
| `JWT_SECRET` | JWT 签名密钥，**>= 32 字符** | `super-secret-jwt-key-change-in-prod` |
| `SMTP_HOST` | SMTP 服务器地址 | `smtp.gmail.com` |
| `SMTP_PORT` | SMTP 端口 | `587` |
| `SMTP_USER` | SMTP 用户名 | `user@gmail.com` |
| `SMTP_PASS` | SMTP 密码 | `app-specific-password` |
| `SMTP_FROM` | 发件人地址 | `noreply@yourdomain.com` |
| `PG_HOST` / `PG_PORT` / `PG_USER` / `PG_PASSWORD` / `PG_DATABASE` | PostgreSQL 连接信息 | 见上文 |

### 推荐变量

| 变量 | 说明 | 默认值 |
|------|------|--------|
| `APP_URL` | 应用访问地址（issuer），用于 OAuth 回调、邮件链接 | `http://localhost:5986` |
| `ENCRYPTION_KEY` | AES-256-GCM 加密密钥（>= 32 字符），用于加密私钥、IdP 配置等敏感字段 | 回退到 `JWT_SECRET`（不推荐） |
| `NODE_ENV` | 运行环境 | `development` |
| `PORT` | 服务端口 | `5986` |

### 可选功能变量

| 变量 | 功能 | 未配置时行为 |
|------|------|-------------|
| `GITHUB_CLIENT_ID` / `GITHUB_CLIENT_SECRET` | GitHub OAuth 登录 | 登录页不显示 GitHub 按钮 |
| `REDIS_URL` | 共享缓存/限流/任务选主 | 退回单机内存实现（仅单实例可用） |
| `RISK_ENGINE_MODE` | 风险引擎模式（`off` / `shadow` / `enforce`） | 默认 `off`，不执行风险评估 |
| `GEOIP_DB_PATH` | MaxMind GeoLite2-City.mmdb 路径 | 地理信号禁用 |
| `ANTHROPIC_API_KEY` | Anthropic Claude API 密钥 | `/api/admin/ai/*` 全部返回 501 |
| `SMS_PROVIDER` | 短信服务商（`console` / `aliyun` / `tencent`） | `console`（仅打日志） |
| `METRICS_TOKEN` | `/metrics` Bearer Token | 未设置仅私网 IP 可访问 |
| `OAUTH_ENFORCE_GRANT_TYPES` | 强制校验客户端 grant_types | `false`（不强制） |

### 连接池调优

| 变量 | 说明 | 默认值 |
|------|------|--------|
| `PG_POOL_MAX` | 最大连接数 | `10` |
| `PG_IDLE_TIMEOUT_SEC` | 空闲连接超时（秒） | `30` |
| `PG_CONNECT_TIMEOUT_SEC` | 连接超时（秒） | `10` |

> 💡 完整变量列表和注释见 [`.env.example`](.env.example)，以 [`server/config.ts`](server/config.ts) 为权威来源。

---

## 数据库管理

### 常用命令

```bash
# 开发环境：直接推送 schema 变更（跳过迁移文件，仅限本地）
pnpm db:push

# 生成迁移文件（修改 server/schema.ts 后必须执行）
pnpm db:generate

# 生产环境：应用迁移文件
pnpm db:migrate

# 可视化数据库管理
pnpm db:studio
```

### 工作流程

```
修改 server/schema.ts
        ↓
   pnpm db:generate    ← 生成 drizzle/*.sql 迁移文件
        ↓
   git commit           ← 提交迁移文件
        ↓
   生产部署前执行 pnpm db:migrate
```

> ⚠️ **重要**：`NODE_ENV=production` 时，服务启动**不会**自动建表。必须在部署流水线或 Helm initContainer 中先执行 `pnpm db:migrate`。

### 默认种子数据

首次建库时自动播种（仅开发环境）：

| 对象 | 值 | 说明 |
|------|-----|------|
| 默认租户 | `default` | 多租户隔离的基础 |
| 默认管理员 | `admin` | 密码随机生成，打印在控制台，首次登录强制改密 |
| 默认客户端 | `client_id = default-client` | client_secret 随机生成，打印在控制台 |

> ⚠️ 生产环境请勿依赖控制台打印的随机凭据，部署后立即在管理后台轮换。

---

## 开发工作流

### 项目结构速览

```
idp-center/
├── server.ts              # 服务入口
├── server/
│   ├── config.ts          # 环境变量 schema（Zod）
│   ├── schema.ts          # Drizzle 表定义（唯一 schema 源）
│   ├── database.ts        # 连接池、迁移、种子
│   ├── routes/            # HTTP 路由
│   ├── oauth/             # OAuth/OIDC 核心逻辑
│   ├── services/          # 业务服务层
│   ├── jobs/              # 定时任务
│   ├── middleware/         # 中间件
│   └── validators/        # Zod 参数校验
├── src/                   # 前端源码（React 19 + TanStack Router）
├── drizzle/               # 生成的 SQL 迁移文件
├── tests/                 # Vitest 测试
├── deploy/helm/           # Helm chart
└── example/               # 独立 Vue 3 接入示例
```

### 常用开发命令

```bash
pnpm dev          # 启动开发服务器（热重载）
pnpm build        # 构建前端 + 后端
pnpm start        # 启动构建产物
pnpm lint         # TypeScript 类型检查
pnpm test         # 运行测试
```

### 代码修改检查清单

| 修改范围 | 需要检查/更新的内容 |
|----------|-------------------|
| 后端 API | 路由文件、schema.ts + 迁移、测试 |
| 前端页面 | 路由定义、登录态、接口响应解析 |
| 新增环境变量 | `server/config.ts`、`.env.example`、`README.md`、Helm `values.yaml` |
| 数据表变更 | `server/schema.ts` → `pnpm db:generate` → 提交 `drizzle/*.sql` |
| 认证流程 | `server/routes/auth.ts`、`server/routes/oidc.ts`、`server/oauth/` |

---

## 测试

```bash
# 运行所有测试
pnpm test

# 类型检查
pnpm lint

# 完整构建验证
pnpm build
```

### 测试分类

| 类型 | 位置 | 是否需要数据库 |
|------|------|---------------|
| 单元测试 | `tests/*.test.ts` | ❌ |
| 属性测试（fast-check） | `tests/*.test.ts` | ❌ |
| 集成测试 | `tests/integration/*.test.ts` | ✅（无数据库时自动跳过） |

> 💡 集成测试通过 `describe.skipIf(!DATABASE_URL && !PG_HOST)` 自动检测数据库可用性，无需手动配置。

---

## Docker 部署

### 构建镜像

```bash
# 本地构建
docker build -t idp-center .

# 多架构构建（Apple Silicon / x86_64）
docker buildx build --platform linux/amd64,linux/arm64 -t idp-center:latest --push .
```

### 运行容器

```bash
docker run -d \
  --name idp-center \
  -p 5986:5986 \
  --env-file .env \
  idp-center
```

> ⚠️ 容器启动前需要：
> 1. PostgreSQL 已运行且可连接
> 2. 已执行过 `pnpm db:migrate`（生产模式不会自动建表）

### Kubernetes 部署

详见 [deploy/helm/idp-center/README.md](deploy/helm/idp-center/README.md)。

关键前置条件：
- 配置 `REDIS_URL`（共享限流/缓存）
- 配置迁移流水线（Helm initContainer 会自动执行 `pnpm db:migrate`）
- 任务选主基于 PG advisory lock 自动生效，无需额外配置

---

## 示例应用

`example/` 是独立的 Vue 3 接入示例，演示如何对接 IDP Center 的认证能力。

```bash
cd example
pnpm install
pnpm dev
```

> ⚠️ 示例应用需要主应用先启动并运行在 http://localhost:5986。

---

## 常见问题排查

### ❌ 启动报错：`JWT_SECRET 至少需要 32 个字符`

**原因**：`.env` 中的 `JWT_SECRET` 长度不足。

**解决**：设置一个 >= 32 字符的密钥：
```env
JWT_SECRET="this-is-a-secure-jwt-secret-key-at-least-32-chars"
```

---

### ❌ 启动报错：`SMTP_HOST is required`

**原因**：SMTP 配置缺失。

**解决**：在 `.env` 中配置 SMTP 信息。如果仅做本地开发，可以使用 Mailtrap、MailHog 等测试邮件服务。

---

### ❌ 数据库连接失败

**原因**：PostgreSQL 未启动或连接信息不正确。

**排查步骤**：
```bash
# 检查 PostgreSQL 是否运行
docker ps | grep postgres

# 测试连接
psql -h localhost -p 5432 -U postgres -d idp_center
```

**常见原因**：
- Docker 容器未启动：`docker start idp-pg`
- 密码不匹配：检查 `.env` 中的 `PG_PASSWORD` 与 Docker 启动时的 `POSTGRES_PASSWORD`
- 端口冲突：确认 5432 端口未被占用

---

### ❌ `pnpm dev` 报表不存在

**原因**：首次启动时 `drizzle-kit push` 失败。

**解决**：
```bash
# 手动推送 schema
pnpm db:push

# 如果仍然失败，检查数据库连接
pnpm db:studio
```

---

### ❌ 忘记管理员密码

**解决方式**：
1. 删除数据库重建（仅限开发环境）：
   ```bash
   docker rm -f idp-pg
   # 重新按快速启动步骤操作
   ```
2. 通过管理后台的密码重置功能（需要 SMTP 配置）

---

### ❌ 端口 5986 被占用

**解决**：修改 `.env` 中的 `PORT`：
```env
PORT=3000
```

---

### ❌ GitHub 登录按钮不显示

**原因**：未配置 GitHub OAuth 凭据。

**解决**：
1. 在 GitHub 创建 OAuth App：Settings → Developer settings → OAuth Apps → New OAuth App
2. Authorization callback URL 填：`http://localhost:5986/api/auth/github/callback`
3. 将 Client ID 和 Secret 写入 `.env`：
   ```env
   GITHUB_CLIENT_ID="your-client-id"
   GITHUB_CLIENT_SECRET="your-client-secret"
   ```

---

### ❌ Redis 相关错误

**原因**：配置了 `REDIS_URL` 但 Redis 未运行。

**解决**：
- 方案 1：启动 Redis
  ```bash
  docker run -d --name idp-redis -p 6379:6379 redis:7
  ```
- 方案 2：移除 `REDIS_URL`（退回单机内存实现，仅单实例可用）

---

### ❌ 生产环境启动后表不存在

**原因**：生产模式不会自动 `drizzle-kit push`。

**解决**：在部署流水线中先执行迁移：
```bash
pnpm db:migrate
```

---

## 相关文档

| 文档 | 说明 |
|------|------|
| [README.md](README.md) | 项目简介、核心能力、API 概览 |
| [AGENTS.md](AGENTS.md) | 面向 AI 协作者的仓库事实基线 |
| [ENTERPRISE-OAUTH-ANALYSIS-COMPLETE.md](ENTERPRISE-OAUTH-ANALYSIS-COMPLETE.md) | 企业级差距分析与当前实施状态 |
| [ENTERPRISE-OAUTH-IMPLEMENTATION-PLAN.md](ENTERPRISE-OAUTH-IMPLEMENTATION-PLAN.md) | 四阶段实施方案 |
| [docs/operations/deployment.md](docs/operations/deployment.md) | 生产部署检查表 |
| [deploy/helm/idp-center/README.md](deploy/helm/idp-center/README.md) | Kubernetes/Helm 部署 |
| [docs/documentation-archive-guideline.md](docs/documentation-archive-guideline.md) | 文档归档规范 |
