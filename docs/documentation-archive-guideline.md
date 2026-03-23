# IDP Center 文档归档规范

## 1. 目的

本规范用于统一 `idp-center` 仓库中的文档沉淀、归档和淘汰方式，避免主应用文档、示例文档、历史说明和运行产物混放。该规范基于当前仓库的实际结构制定，而不是通用模板。

## 2. 适用范围

当前仓库包含两类真实交付物：

- 根目录主应用：`React 19 + Vite + TanStack Router + Express + better-sqlite3`
- `example/` 示例工程：独立的 `Vue 3 + Vite` 对接示例

当前代码行为的主要事实来源如下：

- API 与认证行为：`server/routes/`
- 数据模型与初始化：`server/database.ts`
- 前端路由与登录态恢复：`src/App.tsx`、`src/routes/`
- 统一响应格式：`server/utils/response.ts`
- 回归测试：`tests/`

因此，文档必须围绕以上代码事实归档，不得脱离实现单独演化。

## 3. 文档分层与落位

按内容类型归档到以下位置，目录按需创建，不要求一次性补齐。

| 路径 | 用途 | 备注 |
| --- | --- | --- |
| `README.md` | 仓库入口文档 | 仅保留项目简介、启动方式、最短部署路径、核心链接 |
| `docs/architecture/` | 架构、模块边界、数据流、表结构说明 | 以主应用为主 |
| `docs/api/` | API 契约、鉴权流程、错误码说明 | 以 `server/routes/` 为准 |
| `docs/security/` | OIDC、GitHub OAuth、OTP、会话、账号删除等安全专题 | 安全流程变更时必须同步 |
| `docs/operations/` | 环境变量、部署、备份、迁移、运行维护 | 以 `server/config.ts`、Docker 相关文件为准 |
| `docs/testing/` | 测试策略、运行方式、覆盖边界 | 以 `tests/` 和 `package.json` 脚本为准 |
| `docs/archive/` | 已废弃、被替代、仅保留历史背景的文档 | 必须标记替代文档或废弃原因 |
| `example/README.md` | 示例工程入口文档 | 只描述 `example/` 如何运行和接入 |
| `example/docs/` | 示例工程的专题文档 | 不得与主应用文档混放 |

## 4. 当前仓库的文档归属建议

基于现有文件，当前建议如下：

- `README.md` 继续作为主应用入口文档，不承载过多实现细节。
- `example/README.md` 继续作为 Vue 示例的接入说明，不描述主应用运维细节。
- `example/SESSION_MANAGEMENT.md` 当前应视为历史专题文档。
  原因：文档中引用了 `src/views/Sessions.vue`、`src/stores/auth.ts`、`axios` 拦截器等文件或结构，但当前 `example/` 目录并不存在这些实现。
  后续处理原则：
  1. 如果要继续维护该能力说明，应按当前 `example/` 实现重写。
  2. 如果仅保留历史背景，应迁移到 `docs/archive/` 并补充“适用版本/已失效原因”。

## 5. 命名规范

- 文档文件名统一使用英文小写加中横线，例如：`oidc-token-flow.md`
- 归档文档建议增加日期前缀，例如：`2026-03-session-management-history.md`
- 文档正文可以使用中文；代码路径、命令、接口名保持原样
- 同一主题只保留一个“当前有效版本”，旧版进入 `docs/archive/`

## 6. 每篇文档的最小元信息

除 `README.md` 外，建议每篇文档开头至少包含以下信息：

- `状态`：`active` / `archived` / `draft`
- `范围`：主应用 / `example/` / 运维 / 安全专题
- `最后核对`：日期
- `事实来源`：相关代码路径
- `替代文档`：如已归档则必填

推荐模板：

```md
状态：active
范围：主应用 / 安全专题
最后核对：2026-03-23
事实来源：server/routes/auth.ts, server/routes/oidc.ts, server/database.ts
替代文档：无
```

## 7. 归档触发条件

出现以下情况时，必须同步更新文档；如旧文档不再准确，应归档而不是继续冒充最新说明：

- `server/routes/*.ts` 发生接口、鉴权、参数或错误码变化
- `server/database.ts` 发生表结构、迁移、默认种子变化
- `server/config.ts` 或 `.env.example` 发生环境变量变化
- `package.json` 脚本、启动方式、构建方式变化
- `src/routes/`、`src/App.tsx` 发生登录、跳转、路由模式变化
- `example/` 工程结构或接入方式变化
- 文档中引用的文件、页面、命令已不存在

## 8. 非归档对象边界

以下内容不是归档文档，不得用来替代正式文档：

- 运行产物：`build/`、`dist/`
- 依赖目录：`node_modules/`
- 本地数据：`auth.db`
- 上传目录：`uploads/`
- 本地环境文件：`.env`、`.env.local`
- 生成文件：`src/routeTree.gen.ts`
- 临时测试脚本输出、抓包结果、数据库导出文件

原则：

- 可以在文档中描述这些对象，但不要把它们本身当作文档沉淀
- 如果需要保留运行证据，应提炼成结论性文档，而不是直接归档二进制或快照

## 9. 与当前项目实现相关的补充约束

- 主应用使用 hash 路由，前端行为说明必须与 `src/App.tsx` 和 `src/routes/` 一致
- API 响应格式以 `server/utils/response.ts` 为准，默认结构为 `{ code, data, message, error }`
- 默认管理员和默认客户端来自 `server/database.ts` 的 seed 逻辑，文档引用这些默认值时要说明它们属于开发默认配置
- `.env.example` 中存在 AI Studio / Gemini 说明，但当前服务端强校验来源是 `server/config.ts`；运维文档必须以 `server/config.ts` 为准，不得只抄 `.env.example`

## 10. 文档评审清单

提交前至少检查以下事项：

- 文档路径是否符合分层规则
- 文档是否明确适用范围，是主应用还是 `example/`
- 命令是否能在当前仓库结构下执行
- 引用的文件路径是否真实存在
- 接口、字段、错误码是否与代码一致
- 是否泄露真实密钥、真实邮箱、生产域名等敏感信息
- 如果文档已过时，是否已迁移到 `docs/archive/` 并标注替代关系

## 11. 推荐执行规则

- 功能变更和文档变更尽量同一个提交完成
- 影响外部接入方式的改动，至少同时更新：
  - `README.md` 或 `example/README.md`
  - 对应专题文档
- 当专题文档无法继续证明当前实现时，优先归档，再补新版，不要直接覆盖历史结论
