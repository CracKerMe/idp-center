状态：active
范围：主应用 / 运维
最后核对：2026-08-07
事实来源：server/database.ts, server/config.ts, server/jobs/scheduler.ts, server/services/cache.service.ts, deploy/helm/idp-center/
替代文档：无

# 部署与运维（数据库迁移 / 缓存 / 多副本）

本文档覆盖 [ENTERPRISE-OAUTH-IMPLEMENTATION-PLAN.md](../../ENTERPRISE-OAUTH-IMPLEMENTATION-PLAN.md) 阶段四引入的运维行为变化。日常开发/快速启动请看 [README.md](../../README.md)；Helm 安装步骤见 [deploy/helm/idp-center/README.md](../../deploy/helm/idp-center/README.md)。

## 1. 数据库迁移

- `server/schema.ts` 是唯一 schema 源。改动表结构后必须执行 `pnpm db:generate`，把新产出的 `drizzle/*.sql` 一并提交。
- `NODE_ENV=production` 时，`server/database.ts` 的 `initDatabase()` **不会**再自动跑 `drizzle-kit push`（历史行为在多副本下会竞态、且无法被审查/回滚）。生产部署前必须先执行 `pnpm db:migrate`。
- 本地开发 / CI 单机场景仍可用 `pnpm db:push` 跳过生成迁移文件直接同步。
- Helm chart 的 `db-migrate` initContainer 已经在 [deploy/helm/idp-center/templates/deployment.yaml](../../deploy/helm/idp-center/templates/deployment.yaml) 里接好，非 Helm 部署需要在部署流水线里自行加一步 `pnpm db:migrate`。

## 2. 共享缓存 / 限流（Redis，可选）

- `server/services/cache.service.ts` 提供统一的 `get/set/del/incr` 接口，`REDIS_URL` 未配置时退回进程内 `Map` 实现。
- 单实例部署可以不配置 `REDIS_URL`；一旦扩到多副本（`replicaCount > 1`），必须配置，否则：
  - `server/middleware/rate-limit.ts` 的限流预算按副本各算各的，形同虚设；
  - 签名密钥（`server/services/keys.service.ts`）的 60s 内存缓存在副本间不一致（功能仍正确，只是缓存命中率下降，不是安全问题）。
- 限流失败（Redis 不可达）会 fail-open（放行请求并记 warn 日志），不会因为缓存故障导致登录/令牌接口整体不可用。

## 3. 多副本任务选主

- `server/jobs/scheduler.ts` 用 PostgreSQL 的 `pg_try_advisory_xact_lock` 做非阻塞选主，替代了旧版 `server.ts` 里裸的 `setInterval(cleanupExpiredTokens, ...)`。
- 覆盖的任务：令牌/设备码/PAR/DPoP jti 清理、签名密钥轮换、back-channel logout 投递、审计保留策略清理（以上均在 `cleanupExpiredTokens()` 内）、UEBA 基线夜间重算（`server/jobs/ueba.job.ts`）。
- **不需要额外配置**：只要所有副本连同一个 PostgreSQL，选主自动生效；这是刻意选择 PG advisory lock 而非 Redis `SET NX` 的原因（见实施方案 §4.3）。
- 每个任务的 lock id 是硬编码常量（`server/jobs/scheduler.ts` 里的 `JOBS` 数组），**不要重排或复用同一个 lock id 给不同任务**，否则会导致两个任务互相阻塞对方的选主。

## 4. 风险引擎上线检查表

- `RISK_ENGINE_MODE` 默认 `off`。上线顺序必须是 `off → shadow → enforce`，`shadow` 阶段至少跑两周观察 `GET /api/admin/risk/dashboard` 的信号分布与误报率，这是实施方案的硬性排期约束，不是建议。
- `GEOIP_DB_PATH` 未配置时，新国家/不可能旅行信号不生效（不影响其余规则）；需要这些信号时下载 MaxMind GeoLite2-City.mmdb 并配置路径。
- `enforce` 模式下的 `deny` 会直接拒绝登录，`mfa_required`/`step_up` 只有在用户已启用 MFA 时才会真正生效（没有第二因子时静默放行，见 `server/routes/auth.ts` 里 `riskForcesStepUp` 的注释）。

## 5. LLM 辅助上线检查表

- 未设置 `ANTHROPIC_API_KEY` 时，`/api/admin/ai/*` 全部返回 `501`，不影响其余功能。
- 送给模型的数据经过 `server/utils/redact.ts` 脱敏（邮箱/IP/类电话数字串），但策略草案、合规报告仍属于"建议输出"，任何自动化执行都必须走人工确认后的既有 CRUD 接口（如 `POST /api/admin/risk/policies`），不要新增"AI 直接落库"的路径。
