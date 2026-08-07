# IDP Center Agents Guide

## 1. 项目概览

这是一个以身份认证为核心的单仓库项目，当前实际结构如下：

- 主应用在仓库根目录
  - 前端：`React 19 + Vite + TanStack Router`
  - 后端：`Express + TypeScript`
  - 数据：`PostgreSQL + Drizzle ORM`（`server/schema.ts` 是唯一 schema 源，迁移文件在 `drizzle/`）
- 示例应用在 `example/`
  - `Vue 3 + Vite`
  - 用于演示如何对接主应用提供的认证能力

不要把 `example/` 当成主应用源码的一部分处理。它是独立示例，不是主站前端的子模块。

项目定位与四阶段实施方案见 [ENTERPRISE-OAUTH-ANALYSIS-COMPLETE.md](ENTERPRISE-OAUTH-ANALYSIS-COMPLETE.md) / [ENTERPRISE-OAUTH-IMPLEMENTATION-PLAN.md](ENTERPRISE-OAUTH-IMPLEMENTATION-PLAN.md)：核心 OAuth、企业级功能（MFA/联合身份/RBAC/SCIM/审计）、AI Native（风险引擎/UEBA/LLM 辅助）、云原生（迁移文件化/Redis/任务选主/Helm）四个阶段均已实施，改动这些领域前先读对应章节，避免和既有排期约束冲突。

## 2. 真实入口与事实来源

处理问题时，以下文件是优先阅读对象：

- 服务入口：`server.ts`
- 环境变量与根目录定位：`server/config.ts`
- 数据表、连接池、迁移、种子：`server/database.ts`、`server/schema.ts`
- 认证与用户相关接口：`server/routes/auth.ts`、`server/routes/user.ts`
- OIDC / OAuth 核心逻辑：`server/oauth/`（grant 注册表、client-auth、jwt 签发验证、introspect/revoke、dpop、par），路由接线在 `server/routes/oidc.ts`、`server/routes/well-known.ts`
- GitHub / SAML / OIDC-RP / LDAP 联合身份：`server/routes/github.ts`、`server/routes/federation/`、`server/services/identity-link.service.ts`
- MFA：`server/routes/mfa.ts`、`server/services/mfa.service.ts`、`server/services/mfa-policy.service.ts`
- RBAC / SCIM：`server/services/rbac.service.ts`、`server/routes/scim.ts`
- 风险引擎 / UEBA：`server/services/risk.service.ts`、`server/jobs/ueba.job.ts`、`server/services/geoip.service.ts`
- LLM 辅助（可选功能）：`server/services/ai-assist.service.ts`、`server/utils/redact.ts`
- 定时任务与多副本选主：`server/jobs/scheduler.ts`
- 共享缓存/限流：`server/services/cache.service.ts`、`server/middleware/rate-limit.ts`
- 管理端接口：`server/routes/admin.ts`
- 统一响应格式：`server/utils/response.ts`
- 前端启动与登录态恢复：`src/App.tsx`
- 前端请求封装：`src/utils/fetch.ts`
- 回归测试：`tests/`（`tests/integration/` 需要可用的 PostgreSQL，否则自动 skip）

如果文档、注释和代码冲突，以代码为准，再回补文档。

## 3. 目录职责

| 路径 | 作用 |
| --- | --- |
| `src/` | 主应用前端源码 |
| `src/routes/` | TanStack Router 路由定义（hash 路由） |
| `src/pages/` | 页面组件（含 `src/pages/admin/` 管理后台） |
| `server/routes/` | HTTP 路由接线（auth/oidc/admin/mfa/scim/user/federation/well-known/health） |
| `server/oauth/` | OAuth/OIDC 核心逻辑（grant 处理器、令牌签发/校验、DPoP、PAR、动态注册） |
| `server/services/` | 业务服务层（密钥/MFA/RBAC/风险引擎/AI 辅助/GeoIP/缓存/身份关联/LDAP/邮件/短信等） |
| `server/jobs/` | 定时任务（`scheduler.ts` 做 PG advisory lock 选主，`ueba.job.ts` 夜间基线重算） |
| `server/middleware/` | 认证、租户上下文、限流、IP 白名单、请求 ID、指标采集 |
| `server/validators/` | Zod 参数校验 |
| `server/utils/` | 工具函数（审计、指标、脱敏、设备指纹、token 黑名单等） |
| `drizzle/` | `pnpm db:generate` 产出的 SQL 迁移文件，随代码提交 |
| `deploy/helm/idp-center/` | Kubernetes Helm chart |
| `tests/` | Vitest 测试（单元/属性测试 + `tests/integration/`） |
| `example/` | Vue 接入示例 |
| `build/` | 服务端构建产物 |
| `dist/` | 前端构建产物 |
| `uploads/` | 用户上传文件目录 |

## 4. 常用命令

在仓库根目录执行：

- 安装依赖：`pnpm install`
- 本地开发：`pnpm dev`（`NODE_ENV !== production` 时启动会自动 `drizzle-kit push` 建表）
- 构建：`pnpm build`
- 启动构建产物：`pnpm start`
- 类型检查：`pnpm lint`
- 测试：`pnpm test`
- 生成迁移文件：`pnpm db:generate`（改了 `server/schema.ts` 之后必须跑一次，产物提交到 `drizzle/`）
- 应用迁移（生产/CI）：`pnpm db:migrate`
- 可视化查看数据：`pnpm db:studio`

运行示例应用：

- `cd example && pnpm install`
- `cd example && pnpm dev`

需要本地 PostgreSQL 才能跑集成测试 / 完整启动应用，例如：`docker run -d -p 5432:5432 -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=idp_center postgres:16`。

## 5. 项目内约定

- 主应用前端使用 hash 路由，不要按 history 路由假设跳转逻辑
- API 成功响应默认 `code = 0`，统一结构见 `server/utils/response.ts`
- 请求参数校验优先走 `server/validators/` 和 `server/middleware/validate.ts`
- 新增或修改认证流程时，优先保持以下路径的一致性：
  - `server/routes/*.ts`
  - `server/oauth/`（如涉及令牌签发/校验/grant 处理）
  - `server/schema.ts` + `drizzle/`（新增迁移）
  - `src/utils/fetch.ts`
  - `tests/`
- 新增环境变量时，同时检查：
  - `server/config.ts`（zod schema）
  - `.env.example`
  - `README.md` 环境变量表
  - 相关部署文档（`deploy/helm/idp-center/values.yaml`，如涉及部署行为）
- 新增/修改表结构后必须跑 `pnpm db:generate` 并把 `drizzle/*.sql` 一起提交；生产环境不会自动 `drizzle-kit push`
- 可选功能（Redis、GeoIP、Claude API）一律要求未配置时优雅降级，不得让核心登录/令牌流程依赖它们

## 6. 高风险与易错点

- `src/routeTree.gen.ts` 是生成文件，除非明确需要重新生成，否则不要手改
- `build/`、`dist/`、`uploads/`、`node_modules/`、本地 `.env` 都不是源码编辑目标
- `example/SESSION_MANAGEMENT.md` 当前描述的文件结构与现有 `example/` 不一致，应按历史文档处理
- `docs/PRODUCT_ROADMAP.md` 是早期 P0/P1 路线图，已被 `ENTERPRISE-OAUTH-IMPLEMENTATION-PLAN.md` 的四阶段方案取代并全部实施完成，改动相关领域以后者为准
- `RISK_ENGINE_MODE` 默认 `off`；改为 `enforce` 前必须先跑至少两周 `shadow` 模式观察误报率，这是既定排期约束，不要跳过
- LLM 辅助（`server/services/ai-assist.service.ts`）任何输出都不得被写成自动执行的鉴权决策，只能是人工确认后生效的草案

## 7. 默认数据与本地环境

`server/database.ts` 的 `initDatabase()` 会在本地自动迁移数据库并播种以下默认对象（生产环境要求先手动 `pnpm db:migrate`，见第 4 节）：

- 默认租户：`default`
- 默认管理员：用户名 `admin`，密码为首次启动时随机生成并打印在控制台（首次登录强制改密）
- 默认客户端：`client_id = default-client`，`client_secret` 同样随机生成并打印在控制台

这些默认值仅适用于开发环境说明；随机凭据只在首次建库时打印一次，不会持久化到日志文件，遗失后需通过管理后台重置，不应直接当成生产配置建议。

## 8. 文档规则

本仓库的文档归档规则见 `docs/documentation-archive-guideline.md`。

执行文档更新时遵循以下原则：

- 主应用文档放根目录或 `docs/`
- `example/` 的专题文档放 `example/` 内部
- 已失效文档进入 `docs/archive/`
- 文档必须标注事实来源，并与当前代码保持可核对关系

## 9. 变更前后的最小验证

按修改范围做最低限度验证：

- 仅文档修改：检查路径、命令、文件引用、事实来源是否准确
- 后端改动：至少运行相关测试，必要时补充接口级验证
- 前端改动：检查登录态、路由跳转、接口响应解析
- 认证或安全改动：重点核对 `auth`、`oidc`、`user`、`admin` 路由与数据库字段

如果没有运行测试，要明确说明未验证项。
