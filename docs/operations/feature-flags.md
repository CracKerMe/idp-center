状态：active
范围：主应用 / 运维
最后核对：2026-08-08
事实来源：server/features/registry.ts, server/services/feature.service.ts, server/routes/admin/features.ts, server/routes/features-public.ts
替代文档：无

# 功能开关（Feature Flags）

系统级（全局，非租户级）功能开关系统。让原本只能通过 `.env` + 重启才能调整的可选功能，改为可在管理后台热切换、无需重启即时生效。

## 1. 优先级与解析

```
DB 中存在该 key 的行 → JSON.parse(value) → 校验硬前置条件 → 生效值（source: db）
DB 中不存在该 key   → server/features/registry.ts 里的 envDefault() → 生效值（source: env）
```

`server/config.ts` 里所有相关的 env 变量（`AUTO_HEAL_ENABLED`、`RISK_ENGINE_MODE`、`CAPTCHA_MODE` 等）保持不变，只是作为 `envDefault()` 的数据源，不再被业务代码直接读取。**未在管理后台写入任何记录的部署，行为与升级前完全一致**。

某些开关有"硬前置条件"（如 `githubSso` 需要 `GITHUB_CLIENT_ID`/`GITHUB_CLIENT_SECRET`）：即使管理员在 DB 里把它设为开，只要前置条件不满足，解析出的生效值仍会被钳制为关；管理页会展示对应提示。

## 2. 开关清单

| key | 类型 | 分组 | 生效方式 | 说明 |
|---|---|---|---|---|
| `alert` | boolean | 运维可观测 | 即时 | 事件触发的告警规则匹配与分发 |
| `autoHeal` | boolean | 运维可观测 | 即时 | 健康检查驱动的自动修复动作 |
| `healthChecker` | boolean | 运维可观测 | 即时 | 综合健康检查的定时执行与历史持久化 |
| `eventStorePersistence` | boolean | 运维可观测 | 占位 | 尚无实现，仅登记 |
| `capacityForecast` | boolean | 运维可观测 | 占位 | 尚无实现，仅登记 |
| `alertAiEnrichment` | boolean | 运维可观测 | 占位 | 尚无实现，依赖 `aiAssist` |
| `riskEngine` | triState (off/shadow/enforce) | 安全风控 | 即时 | 登录风险评分模式 |
| `captcha` | triState (off/shadow/enforce) | 安全风控 | 即时 | 滑块验证码模式 |
| `uebaBaseline` | boolean | 安全风控 | 即时 | 用户行为基线夜间重算任务 |
| `mfa` | boolean | 认证能力 | 即时 | 仅阻止新绑定，已绑定用户登录校验不受影响 |
| `githubSso` | boolean | 认证能力 | 即时 | 需要 GitHub 凭据 |
| `deviceFlow` | boolean | 认证能力 | 即时 | OAuth Device Authorization Grant |
| `dynamicClientRegistration` | boolean | 认证能力 | 即时 | 与租户级 `tenants.settings.dynamicClientRegistration` 是 AND 关系 |
| `aiAssist` | boolean | AI 辅助 | 即时 | 需要 `ANTHROPIC_API_KEY` |

## 3. 管理入口

- `GET /api/admin/features`：返回全量清单（含 `source`、`effectiveImmediately`、`dependenciesSatisfied`、`hardRequirementUnmet` 等元信息），仅 platform admin 可访问。
- `PUT /api/admin/features/:key`：写入新值。未知 key → 404；值类型不匹配 → 400；依赖未满足（如 `aiAssist` 关闭时尝试开 `alertAiEnrichment`）→ 409；硬前置条件不满足时仍会写入 DB，但解析值钳制为关。
- `POST /api/admin/features/reset/:key`：删除 DB 覆盖，回落到 env 默认值。
- 前端页面：`/admin/features`（`src/pages/admin/FeatureFlags.tsx`）。
- `GET /api/features/public`：无需认证的只读子集（`githubSso`/`deviceFlow`/`mfa`/`dynamicClientRegistration`），供登录页等未认证 UI 使用。刻意不包含 `riskEngine`/`captcha`（避免向攻击者暴露反滥用姿态）和纯内部运维类开关。

所有开关变更都会写入审计日志（`AuditAction.FEATURE_FLAG_UPDATED`/`FEATURE_FLAG_RESET`）。

## 4. 多副本传播

`setFlag()`/`resetFlag()` 通过 `server/services/event-bus.service.ts` 的 `eventBus.emit({type: 'system.feature.changed', ...})` 广播：

- 单实例：本地 dispatch 立即生效。
- 多副本 + `REDIS_URL` 已配置：经 Redis Stream 广播到其他副本，各自重读该 key。
- 多副本 + 未配置 `REDIS_URL`：**没有实时跨副本同步**，每个副本靠 `startPeriodicResync()`（默认 30 秒）定期全量重载兜底 —— 与 `server/services/cache.service.ts` 声明的"无 Redis 不适合多副本"限制一致。需要严格实时一致性的多副本部署应配置 `REDIS_URL`。

## 5. 添加新开关

1. 在 `server/features/registry.ts` 的 `FEATURE_REGISTRY` 里加一条（`type`、`category`/`categoryLabel`、`label`、`description`、`effect`、`envDefault`，按需加 `dependsOn`/`hardRequirement`）。
2. 在实际业务代码的调用点用 `isEnabled('yourKey')` 或 `getValue('yourKey')` 替换原来的 `config.XXX` 直读，检查点必须放在**每次执行时**（每个请求 / 每个 tick / 每个事件），而不是模块加载或注册时——否则热切换不生效。
3. 如果该能力对应一个 Express 路由，用 `server/middleware/feature-gate.ts` 的 `featureGate('yourKey', 404 | 503)` 挂载。
4. 无需改动数据库 schema 或迁移——`feature_flags` 表的 `key` 列是任意字符串，新 key 自动可用。
