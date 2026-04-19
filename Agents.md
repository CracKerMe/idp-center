# IDP Center Agents Guide

## 1. 项目概览

这是一个以身份认证为核心的单仓库项目，当前实际结构如下：

- 主应用在仓库根目录
  - 前端：`React 19 + Vite + TanStack Router`
  - 后端：`Express + TypeScript`
  - 数据：`better-sqlite3`，本地数据库文件为 `auth.db`
- 示例应用在 `example/`
  - `Vue 3 + Vite`
  - 用于演示如何对接主应用提供的认证能力

不要把 `example/` 当成主应用源码的一部分处理。它是独立示例，不是主站前端的子模块。

## 2. 真实入口与事实来源

处理问题时，以下文件是优先阅读对象：

- 服务入口：`server.ts`
- 环境变量与根目录定位：`server/config.ts`
- 数据表、迁移、默认种子：`server/database.ts`
- 认证与用户相关接口：`server/routes/auth.ts`、`server/routes/user.ts`
- OIDC / OAuth 能力：`server/routes/oidc.ts`、`server/routes/github.ts`
- 管理端接口：`server/routes/admin.ts`
- 统一响应格式：`server/utils/response.ts`
- 前端启动与登录态恢复：`src/App.tsx`
- 前端请求封装：`src/utils/fetch.ts`
- 回归测试：`tests/`

如果文档、注释和代码冲突，以代码为准，再回补文档。

## 3. 目录职责

| 路径 | 作用 |
| --- | --- |
| `src/` | 主应用前端源码 |
| `src/routes/` | TanStack Router 路由定义 |
| `src/pages/` | 页面组件 |
| `server/` | 后端路由、校验、服务、工具 |
| `tests/` | Vitest 测试 |
| `example/` | Vue 接入示例 |
| `build/` | 服务端构建产物 |
| `dist/` | 前端构建产物 |
| `uploads/` | 用户上传文件目录 |

## 4. 常用命令

在仓库根目录执行：

- 安装依赖：`pnpm install`
- 本地开发：`pnpm dev`
- 构建：`pnpm build`
- 启动构建产物：`pnpm start`
- 类型检查：`pnpm lint`
- 测试：`pnpm test`

运行示例应用：

- `cd example && pnpm install`
- `cd example && pnpm dev`

## 5. 项目内约定

- 主应用前端使用 hash 路由，不要按 history 路由假设跳转逻辑
- API 成功响应默认 `code = 0`，统一结构见 `server/utils/response.ts`
- 请求参数校验优先走 `server/validators/` 和 `server/middleware/validate.ts`
- 新增或修改认证流程时，优先保持以下路径的一致性：
  - `server/routes/*.ts`
  - `server/database.ts`
  - `src/utils/fetch.ts`
  - `tests/`
- 新增环境变量时，同时检查：
  - `server/config.ts`
  - `.env.example`
  - 相关部署文档

## 6. 高风险与易错点

- `auth.db` 是运行中的本地数据库，不是稳定源码，也不是文档来源
- `src/routeTree.gen.ts` 是生成文件，除非明确需要重新生成，否则不要手改
- `build/`、`dist/`、`uploads/`、`node_modules/` 都不是源码编辑目标
- `example/SESSION_MANAGEMENT.md` 当前描述的文件结构与现有 `example/` 不一致，应按历史文档处理
- `package.json` 的 `name` 仍是 `react-example`，不要据此误判项目品牌或目录职责
- `.env.example` 带有 AI Studio / Gemini 注释，但当前服务端运行时校验以 `server/config.ts` 为准

## 7. 默认数据与本地环境

`server/database.ts` 会在本地自动建立并迁移数据库，同时种子以下默认对象：

- 默认租户：`default`
- 默认管理员：`admin / Admin@IdpCenter2024!`（⚠️ 仅开发默认值，生产环境请立即修改）
- 默认客户端：
  - `client_id = default-client`
  - `client_secret = secret123`

这些默认值仅适用于开发环境说明，不应直接当成生产配置建议。

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
