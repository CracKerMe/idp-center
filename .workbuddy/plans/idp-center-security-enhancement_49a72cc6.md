---
name: idp-center-security-enhancement
overview: 为 IDP Center 项目添加安全增强功能：helmet 安全头、Access Token 黑名单机制、Zod API 验证、统一 API 响应格式、测试覆盖、暗色模式支持，以及验证逻辑模块化重构。
todos:
  - id: setup-helmet
    content: 安装 helmet 依赖并在 server.ts 中配置安全头
    status: completed
  - id: token-blacklist
    content: 创建 token-blacklist.ts 模块并集成到认证中间件
    status: completed
  - id: zod-validators
    content: 创建验证器目录结构和请求验证中间件
    status: completed
    dependencies:
      - token-blacklist
  - id: unified-response
    content: 创建统一响应格式工具函数
    status: completed
  - id: refactor-routes
    content: 改造 auth/user/admin 路由使用验证器和统一响应
    status: completed
    dependencies:
      - zod-validators
      - unified-response
  - id: dark-mode
    content: 实现前端暗色模式支持（Hook、组件、样式）
    status: completed
  - id: add-tests
    content: 添加认证和黑名单相关的单元测试和集成测试
    status: completed
    dependencies:
      - refactor-routes
---

## 产品概述

这是一个 IdP (Identity Provider) 认证中心系统，基于 Express + React 技术栈，提供用户注册、登录、OAuth、OIDC、MFA 等认证功能。当前需要增强安全性、代码质量和用户体验。

## 核心功能需求

1. **安全头设置**: 添加 helmet 中间件，配置 CSP、X-Frame-Options、X-Content-Type-Options 等安全响应头
2. **Access Token 黑名单**: 增强现有 revoked 机制，支持即时吊销 Access Token
3. **API 请求验证**: 使用 zod 对所有 API 请求参数进行结构化验证
4. **统一响应格式**: 标准化 API 响应为 `{ message, data, error, code }` 格式
5. **测试覆盖**: 为核心认证逻辑、API 端点增加单元测试和集成测试
6. **暗色模式**: 前端支持跟随系统偏好或手动切换暗色/亮色主题
7. **验证逻辑抽取**: 将分散在路由中的验证逻辑抽取到独立模块

## 补充说明

- 现有 `access_tokens` 表已有 `revoked` 字段，黑名单机制可复用
- 当前 API 响应格式不统一，需要全局改造
- 已有 vitest 测试框架，需扩展测试覆盖
- 前端使用 Tailwind CSS 4，支持 dark: 前缀实现暗色模式

## 技术栈

- **后端框架**: Express + TypeScript
- **数据库**: PostgreSQL + Drizzle ORM（drizzle-orm/postgres-js；已于 pg-support 迁移完成，不再是 SQLite）
- **验证库**: zod (已有 v4.3.6)
- **安全中间件**: helmet (需新增)
- **测试框架**: vitest + @vitest/coverage-v8
- **前端框架**: React 19 + TanStack Router
- **样式**: Tailwind CSS 4

## 实现方案

### 1. Helmet 安全头配置

安装 `helmet` 依赖，在 `server.ts` 中注册中间件。配置 CSP 限制脚本和样式来源，设置 X-Frame-Options 为 DENY，X-Content-Type-Options 为 nosniff。

### 2. Access Token 黑名单机制

扩展现有 `access_tokens.revoked` 字段的用法:

- 创建 `server/utils/token-blacklist.ts` 模块
- 提供 `revokeToken(token)` 和 `isTokenRevoked(token)` 方法
- 在认证中间件中集成黑名单检查
- 在密码修改、账户封禁、登出等场景调用吊销方法

### 3. Zod API 验证

创建 `server/validators/` 目录:

- 为每个路由定义请求 schema (body, query, params)
- 创建验证中间件 `validateRequest(schema)`
- 统一返回 400 错误和详细验证信息

### 4. 统一响应格式

创建 `server/utils/response.ts`:

```typescript
interface ApiResponse<T> {
  message?: string;
  data?: T;
  error?: string;
  code?: string;
}
```

提供 `success()`, `error()`, `paginated()` 辅助函数，逐步改造所有路由。

### 5. 测试覆盖

- 为验证模块添加单元测试
- 为 API 端点添加集成测试 (使用 supertest)
- 覆盖核心认证流程: 注册、登录、Token 刷新、密码重置

### 6. 暗色模式实现

- 创建 `src/hooks/useTheme.ts` 管理主题状态
- 支持 `system`、`light`、`dark` 三种模式
- 使用 localStorage 持久化用户偏好
- 在 AppHeader 添加主题切换按钮
- 更新 Tailwind 组件使用 `dark:` 前缀

### 7. 验证逻辑抽取

创建 `server/validators/auth.validator.ts`:

- 登录验证 schema (username, password, otp)
- 注册验证 schema (username, email, password)
- 密码重置验证 schema
- 统一错误消息格式

## 目录结构

```
/Volumes/7400-1Tb/idp-center/
├── server/
│   ├── middleware/
│   │   ├── auth.ts           # [MODIFY] 集成黑名单检查
│   │   └── validate.ts       # [NEW] 请求验证中间件
│   ├── validators/
│   │   ├── index.ts          # [NEW] 验证器导出
│   │   ├── auth.validator.ts # [NEW] 认证相关验证 schema
│   │   ├── user.validator.ts # [NEW] 用户相关验证 schema
│   │   └── admin.validator.ts# [NEW] 管理相关验证 schema
│   ├── utils/
│   │   ├── response.ts       # [NEW] 统一响应格式
│   │   └── token-blacklist.ts# [NEW] Token 黑名单管理
│   ├── routes/
│   │   ├── auth.ts           # [MODIFY] 使用验证器和统一响应
│   │   ├── user.ts           # [MODIFY] 使用验证器和统一响应
│   │   ├── admin.ts          # [MODIFY] 使用验证器和统一响应
│   │   ├── oidc.ts           # [MODIFY] 使用验证器和统一响应
│   │   └── github.ts         # [MODIFY] 使用验证器和统一响应
├── src/
│   ├── hooks/
│   │   └── useTheme.ts       # [NEW] 主题管理 Hook
│   ├── components/
│   │   ├── AppHeader.tsx     # [MODIFY] 添加主题切换按钮
│   │   └── ThemeToggle.tsx   # [NEW] 主题切换组件
│   ├── index.css             # [MODIFY] 添加暗色模式 CSS 变量
│   └── App.tsx               # [MODIFY] 初始化主题
├── server.ts                 # [MODIFY] 添加 helmet 中间件
├── package.json              # [MODIFY] 添加 helmet 依赖
└── tests/
    ├── auth.test.ts          # [NEW] 认证 API 测试
    ├── token-blacklist.test.ts# [NEW] 黑名单单元测试
    └── response.test.ts      # [NEW] 响应格式测试
```

## 实现要点

- 黑名单检查已在 `authenticateToken` 中间件存在基础实现，需优化性能
- 响应格式改造需渐进式进行，避免破坏现有前端
- 暗色模式需同时更新所有页面组件的样式

## Agent Extensions

### SubAgent

- **code-explorer**: 用于深入探索现有代码模式、确认验证逻辑分布、识别需要改造的 API 端点数量，确保改造覆盖完整且不遗漏