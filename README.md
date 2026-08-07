<div align="center">

# 🔐 IDP Center

**企业级 OIDC / OAuth 2.1 身份认证中心**

多租户 · RS256 + JWKS · MFA(TOTP/Email/SMS/WebAuthn) · SAML/OIDC/LDAP 联合身份 · RBAC + SCIM · 风险引擎 · AI 辅助运维

[![TypeScript](https://img.shields.io/badge/TypeScript-5.8-blue.svg)](https://www.typescriptlang.org/)
[![React](https://img.shields.io/badge/React-19-61dafb.svg)](https://react.dev/)
[![Express](https://img.shields.io/badge/Express-4-000000.svg)](https://expressjs.com/)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-Drizzle_ORM-4169E1.svg)](https://orm.drizzle.team/)
[![Vitest](https://img.shields.io/badge/Tests-fast--check-brightgreen.svg)](https://vitest.dev/)

</div>

---

## 📄 文档地图

- **本文档**：项目简介、核心能力、API 概览
- **[STARTUP.md](STARTUP.md)**：**启动帮助文档** — 从零到运行的完整指引、环境变量详解、常见问题排查
- [ENTERPRISE-OAUTH-ANALYSIS-COMPLETE.md](ENTERPRISE-OAUTH-ANALYSIS-COMPLETE.md) — 企业级差距分析与当前实施状态
- [ENTERPRISE-OAUTH-IMPLEMENTATION-PLAN.md](ENTERPRISE-OAUTH-IMPLEMENTATION-PLAN.md) — 四阶段可实施方案（表结构、函数签名、排期约束）
- [AGENTS.md](AGENTS.md) — 面向 AI 协作者/新贡献者的仓库事实基线
- [docs/operations/deployment.md](docs/operations/deployment.md) — 数据库迁移/Redis/多副本选主/风险引擎与 LLM 辅助上线检查表
- [docs/documentation-archive-guideline.md](docs/documentation-archive-guideline.md) — 文档分层与归档规范
- [deploy/helm/idp-center/README.md](deploy/helm/idp-center/README.md) — Kubernetes/Helm 部署前置条件

> 📁 已归档文档见 [docs/archive/](docs/archive/)，包括早期路线图（`PRODUCT_ROADMAP.md`）和历史会话管理说明（`SESSION_MANAGEMENT.md`）。

---

## ✨ 核心能力

### 🔑 核心认证（阶段 0-1）
- 注册 / 登录 / 登出 / 密码重置 / 邮箱验证，强密码策略 + 历史密码限制 + 定期轮换
- **RS256 + JWKS + 密钥轮换**（`/.well-known/jwks.json`，90 天轮换，HS256 兼容窗口已下线）
- 授权码 + PKCE、**client_credentials**、**device_code**（RFC 8628）、**token_exchange**（RFC 8693）
- `/introspect`（RFC 7662）、`/revoke`（RFC 7009）、动态客户端注册（RFC 7591/7592）、PAR（RFC 9126）、DPoP（RFC 9449）
- OIDC 会话串联、RP-initiated / front-channel / back-channel 登出

### 🏢 企业级功能（阶段 2）
- **MFA**：TOTP、Email OTP、SMS OTP（阿里云/腾讯云/Console）、WebAuthn/FIDO2、恢复码，`acr`/`amr` step-up
- **联合身份**：SAML 2.0 SP、OIDC RP、LDAP/AD，GitHub 登录已纳入同一 IdP 框架，JIT 建号
- **RBAC + SCIM 2.0**：角色/权限/用户组，`platform-admin` / `tenant-admin` 双层隔离，`/scim/v2` 对接 Okta/Azure AD
- **审计与合规**：哈希链防篡改、CSV/JSONL 流式导出、SOC2/GDPR 差距报表、按租户保留策略
- **可观测性**：Prometheus `/metrics`、`/livez`、`/readyz`、结构化日志（trace/span/tenant/request id）

### 🤖 AI Native（阶段 3）
- **风险引擎**（`RISK_ENGINE_MODE=off|shadow|enforce`）：新设备/新国家/不可能旅行/新 ASN/异常时段/近期失败规则打分，`risk_policies` 可配置分数区间 → 动作
- **UEBA**：夜间基线重算 + 登录时增量更新，令牌刷新时重估会话风险，异常跳变自动撤销会话
- **LLM 辅助**（需 `ANTHROPIC_API_KEY`）：审计摘要、自然语言风险策略草案（人工确认后生效）、合规差距检查 —— 全部只读建议，绝不直接触发鉴权动作，发送前对 PII 脱敏

### ☁️ 云原生（阶段 4）
- 迁移文件化：生产环境不再 `drizzle-kit push`，走 `pnpm db:migrate`
- Redis 共享缓存 + 限流（`REDIS_URL` 未配置时退回单机内存实现）
- 基于 PG advisory lock 的任务选主（清理 / 密钥轮换 / UEBA / 审计归档），多副本不重复执行
- [Helm chart](deploy/helm/idp-center)：Deployment/HPA/PDB/Ingress + db-migrate initContainer

---

## 🏗️ 技术栈

| 层级 | 技术 |
|------|------|
| **前端** | React 19 + Vite + TanStack Router + Tailwind CSS 4 |
| **后端** | Express 4 + TypeScript 5.8 |
| **数据库** | PostgreSQL + Drizzle ORM（迁移文件在 `drizzle/`） |
| **缓存/限流** | Redis（`ioredis`，可选，未配置时退回内存实现） |
| **加解密** | `jose`（RS256/JWKS）、AES-256-GCM（`server/services/crypto.ts`） |
| **联合身份** | `@node-saml/node-saml`、`openid-client`、`ldapts` |
| **MFA** | `otplib`（TOTP）、`@simplewebauthn/*`（WebAuthn） |
| **AI** | `@anthropic-ai/sdk`（可选） |
| **可观测性** | `prom-client` |
| **测试** | Vitest + Supertest + fast-check（属性测试） |
| **部署** | Docker（distroless 两阶段构建）、Helm |

---

## 📁 项目结构

```
idp-center/
├── src/                      # 前端源码（React + TanStack Router）
│   ├── pages/                # 页面组件（含 pages/admin/ 管理后台）
│   ├── routes/                # 路由定义（history 路由）
│   └── utils/fetch.ts        # 请求封装
├── server/
│   ├── routes/                # API 路由（auth/oidc/admin/mfa/scim/user/federation/well-known/health）
│   ├── oauth/                 # OAuth/OIDC 核心逻辑（grant 注册表、client-auth、jwt、introspect/revoke、dpop、par…）
│   ├── services/              # 业务服务（keys/mfa/rbac/risk/ai-assist/geoip/cache/identity-link/ldap…）
│   ├── jobs/                  # 定时任务（scheduler.ts 选主、ueba.job.ts）
│   ├── middleware/             # 认证、租户上下文、限流、IP 白名单
│   ├── validators/            # Zod 参数校验
│   ├── utils/                  # 工具函数（audit、metrics、redact、device-fingerprint…）
│   ├── schema.ts               # Drizzle 表定义（唯一 schema 源）
│   └── database.ts             # 连接池、迁移、种子数据
├── drizzle/                    # 生成的 SQL 迁移文件（`pnpm db:generate` 产出）
├── deploy/helm/idp-center/     # Helm chart
├── tests/                      # Vitest 测试（单元/属性 + tests/integration 集成）
├── server.ts                   # 服务入口
└── example/                    # 独立的 Vue 3 接入示例（不是主应用的一部分）
```

---

## 🚀 快速开始

### 环境要求

- Node.js >= 18，pnpm
- PostgreSQL 16（本地可用 Docker 起）

### 安装与运行

```bash
# 1. 起本地 PostgreSQL
docker run -d -p 5432:5432 -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=idp_center postgres:16

# 2. 安装依赖
pnpm install

# 3. 配置环境变量
cp .env.example .env
# 编辑 .env：至少配置 JWT_SECRET、SMTP_*、PG_* 或 DATABASE_URL

# 4. 启动开发服务器（开发环境会自动 drizzle-kit push 建表 + 播种默认数据）
pnpm dev
```

访问 http://localhost:5986

### 默认账号（仅开发环境，首次启动随机生成并打印在控制台）

| 角色 | 用户名 | 说明 |
|------|--------|------|
| 管理员 | `admin` | 首次登录强制修改密码 |

同时会生成一个默认 OAuth 客户端（`client_id = default-client`），client secret 一并打印在启动日志中。

> ⚠️ 生产环境请勿依赖控制台打印的随机凭据，部署后立即在管理后台轮换。

---

## ⚙️ 环境变量

完整列表见 [`.env.example`](.env.example)，按功能分组的关键变量：

| 分组 | 变量 | 必需 | 说明 |
|------|------|------|------|
| 基础 | `APP_URL` / `JWT_SECRET` | ✅ | 应用地址（issuer）、JWT 签名密钥（≥32 字符） |
| 邮件 | `SMTP_HOST/PORT/USER/PASS/FROM` | ✅ | 用于验证邮件、密码重置、Email OTP |
| 数据库 | `DATABASE_URL` 或 `PG_HOST/PORT/USER/PASSWORD/DATABASE` | ✅ | PostgreSQL 连接；`PG_POOL_MAX/PG_IDLE_TIMEOUT_SEC/PG_CONNECT_TIMEOUT_SEC` 可调连接池 |
| 加密 | `ENCRYPTION_KEY` | 推荐 | 私钥/IdP 配置等敏感字段的 AES-256-GCM 密钥，未设置回退 `JWT_SECRET` |
| GitHub 登录 | `GITHUB_CLIENT_ID/SECRET/CALLBACK_URL` | ❌ | 未配置则登录页不显示 GitHub 按钮 |
| OAuth 强校验 | `OAUTH_ENFORCE_GRANT_TYPES` | ❌ | 开启后强制校验客户端 `grant_types`（先 warn-only 灰度） |
| MFA/SMS | `SMS_PROVIDER`、`ALIYUN_SMS_*`、`TENCENT_SMS_*` | ❌ | 默认 `console`（仅打日志，供 dev/test） |
| 风险引擎 | `RISK_ENGINE_MODE`、`GEOIP_DB_PATH` | ❌ | `off\|shadow\|enforce`；GeoIP 库路径未设置则地理信号禁用 |
| AI 辅助 | `ANTHROPIC_API_KEY` | ❌ | 未设置则 `/api/admin/ai/*` 全部返回 501 |
| 缓存/限流 | `REDIS_URL` | ❌ | 未设置退回单实例内存实现（多副本部署前必须配置） |
| 可观测性 | `METRICS_TOKEN`、`APP_VERSION` | ❌ | `/metrics` 的 Bearer 保护；未设置仅私网 IP 可访问 |

---

## 🔧 GitHub OAuth 配置

1. GitHub → **Settings → Developer settings → OAuth Apps → New OAuth App**
2. Authorization callback URL 填 `http://localhost:5986/api/auth/github/callback`（生产环境改为实际域名）
3. 复制 Client ID / Secret 写入 `.env` 的 `GITHUB_CLIENT_ID` / `GITHUB_CLIENT_SECRET`

未配置时该功能自动禁用，登录页不显示按钮。

---

## 📡 API 概览

完整端点、请求/响应结构见各路由文件（`server/routes/*.ts`、`server/routes/federation/*.ts`）；下表仅列出模块入口。

| 前缀 | 模块 | 关键能力 |
|------|------|----------|
| `/api/auth` | 认证 | 注册/登录/登出/刷新、MFA 挑战与验证、密码重置、邮箱验证 |
| `/api/auth/github` | GitHub OAuth | 发起登录、回调、Token 交换 |
| `/api/oidc` | OIDC/OAuth2 | `/authorize`、`/token`（grant 注册表）、`/userinfo`、`/introspect`、`/revoke`、`/device_authorization`、`/par`、`/register`（动态客户端）、`/end_session` |
| `/.well-known` | 发现 | `openid-configuration`、`jwks.json`（租户无关，独立挂载） |
| `/api/user` | 用户自服务 | 资料、密码、会话、可信设备、已关联账号、数据导出 |
| `/api/user/mfa` | MFA | TOTP/Email/SMS/WebAuthn 注册与校验、恢复码、注销因子 |
| `/api/federation` | 联合身份 | `/:alias/saml/{login,acs,metadata}`、`/:alias/oidc/{login,callback}`、`/:alias/ldap/login` |
| `/scim/v2` | SCIM 2.0 | `/Users`、`/Groups`，客户端凭证 + `scim:read`/`scim:write` scope 认证 |
| `/api/admin` | 管理后台 | 用户/客户端/租户/会话/审计/合规报表/IdP 管理/RBAC，以及本次新增的 `/risk/*`、`/ai/*` |
| `/` (根路径) | 健康检查 | `/livez`、`/readyz`、`/metrics`（Prometheus）、`/health`（兼容） |

---

## 🧪 测试

```bash
pnpm test    # Vitest：单元 + 属性测试(fast-check) + 集成测试
pnpm lint    # tsc --noEmit 类型检查
pnpm build   # 前端 + 后端构建
```

- 单元/属性测试无需数据库即可运行；`tests/integration/*.test.ts` 通过 `describe.skipIf(!DATABASE_URL && !PG_HOST)` 在没有可用 PostgreSQL 时自动跳过。
- 越权类断言单独成文件（`tests/integration/rbac.test.ts`）。

---

## 🗄️ 数据库迁移

```bash
pnpm db:generate   # 改动 server/schema.ts 后生成 drizzle/*.sql
pnpm db:migrate    # 生产环境部署前执行；应用启动本身不再自动 push
pnpm db:push       # 仅限本地开发：跳过生成迁移文件直接同步 schema
pnpm db:studio     # 可视化查看数据
```

`NODE_ENV=production` 时 `initDatabase()` 不会再自动跑 `drizzle-kit push`（历史上这个行为在多副本部署下会产生竞态）；部署流水线或 Helm 的 `db-migrate` initContainer 需要先执行 `pnpm db:migrate`。

---

## 🐳 Docker 部署

```bash
docker build -t idp-center .

# 多架构构建（Apple Silicon / x86_64）
docker buildx build --platform linux/amd64,linux/arm64 -t idp-center:latest --push .

docker run -d \
  --name idp-center \
  -p 5986:5986 \
  --env-file .env \
  idp-center
```

镜像启动前需要能连接到一个已运行的 PostgreSQL（见环境变量表），并已执行过 `pnpm db:migrate`（生产模式下容器自身不再建表）。

多副本部署请参考 [deploy/helm/idp-center](deploy/helm/idp-center)：需要先配置好 `REDIS_URL`（共享限流/缓存）与迁移流水线，任务选主基于 PG advisory lock 自动生效、无需额外配置。

---

## 📚 示例应用

`example/` 是一个独立的 Vue 3 接入示例，演示如何对接 IDP Center 的认证能力（不是主应用源码的一部分）：

```bash
cd example
pnpm install
pnpm dev
```

---

## 📄 许可证

MIT
