状态：active
范围：主应用 / API 契约
最后核对：2026-04-19
事实来源：server/routes/admin.ts, server/routes/auth.ts, server/validators/admin.validator.ts, server/validators/auth.validator.ts
替代文档：无

# 密码策略 API

## 概述

密码策略相关 API 分为两部分：
- **管理员 API**（`/api/admin`）：租户策略配置的 CRUD
- **认证 API**（`/api/auth`）：过期密码修改端点

所有响应遵循统一格式 `{ code, data?, message?, error? }`，`code: 0` 表示成功。

---

## 管理员 API

### GET `/api/admin/tenants/:tenantId/password-policy`

查询指定租户的密码策略配置。

**鉴权**：`authenticateAdmin`（需要管理员 JWT）

**响应 200**：

```json
{
  "code": 0,
  "data": {
    "tenant_id": "acme-corp",
    "min_length": 12,
    "history_count": 8,
    "rotation_enabled": true,
    "rotation_period_days": 60,
    "updated_at": "2026-01-15T10:30:00.000Z"
  }
}
```

> 若租户无自定义配置，返回系统默认值（`min_length: 8, history_count: 5, rotation_enabled: false, rotation_period_days: 90`），`updated_at` 为 `null`。

---

### PUT `/api/admin/tenants/:tenantId/password-policy`

创建或更新指定租户的密码策略配置（UPSERT 语义）。

**鉴权**：`authenticateAdmin`

**请求体**：

```json
{
  "min_length": 12,
  "history_count": 8,
  "rotation_enabled": true,
  "rotation_period_days": 60
}
```

**字段约束**（Zod 校验）：

| 字段 | 类型 | 约束 |
|------|------|------|
| `min_length` | integer | 6 ~ 128 |
| `history_count` | integer | 1 ~ 24 |
| `rotation_enabled` | boolean | — |
| `rotation_period_days` | integer | 1 ~ 365 |

**响应 200**：

```json
{
  "code": 0,
  "message": "Password policy updated successfully"
}
```

**错误响应**：

| 状态码 | 错误码 | 原因 |
|--------|--------|------|
| 400 | `VALIDATION_ERROR` | 参数不符合约束 |
| 401 | `AUTH_UNAUTHORIZED` | 未提供或无效的管理员 token |

---

## 认证 API

### POST `/api/auth/password/change-expired`

允许密码已过期的用户在不完成完整登录流程的情况下修改密码。

**鉴权**：无（通过用户名 + 当前密码验证身份）

**请求体**：

```json
{
  "username": "alice",
  "current_password": "OldPass123!",
  "new_password": "NewPass456@"
}
```

**处理流程**：
1. 验证用户名 + 当前密码（`bcrypt.compareSync`）
2. 确认该租户已启用密码轮换且密码确实已过期（防止绕过）
3. 对新密码执行完整策略校验（`validatePassword`）
4. 更新 `password_hash` 和 `password_changed_at`
5. 写入密码历史记录（`recordPasswordHistory`）
6. 写入审计日志 `PASSWORD_CHANGED_EXPIRED`

**响应 200**：

```json
{
  "code": 0,
  "message": "Password changed successfully"
}
```

**错误响应**：

| 状态码 | 错误码 | 原因 |
|--------|--------|------|
| 401 | `AUTH_INVALID_CREDENTIALS` | 用户名或当前密码错误 |
| 400 | `VALIDATION_PASSWORD_WEAK` | 新密码不符合策略，`details` 数组包含所有违规项 |
| 403 | `VALIDATION_ERROR` | 密码未过期，不允许使用此端点 |

**400 响应示例**（多条违规）：

```json
{
  "error": "Password does not meet requirements",
  "code": "VALIDATION_PASSWORD_WEAK",
  "details": [
    { "code": "PASSWORD_MISSING_UPPERCASE", "message": "密码必须包含至少一个大写字母" },
    { "code": "PASSWORD_TOO_COMMON",        "message": "密码过于常见，请使用更复杂的密码" }
  ]
}
```

---

## 密码相关错误码一览

| 错误码 | 含义 | 触发场景 |
|--------|------|----------|
| `PASSWORD_MISSING_UPPERCASE` | 缺少大写字母 | 注册、重置、修改密码 |
| `PASSWORD_MISSING_LOWERCASE` | 缺少小写字母 | 同上 |
| `PASSWORD_MISSING_DIGIT` | 缺少数字 | 同上 |
| `PASSWORD_MISSING_SPECIAL` | 缺少特殊符号 | 同上 |
| `PASSWORD_TOO_SHORT` | 长度不足 | 同上 |
| `PASSWORD_TOO_COMMON` | 弱口令字典命中 | 同上 |
| `PASSWORD_RECENTLY_USED` | 与历史密码重复 | 重置、修改密码（注册除外） |
| `PASSWORD_EXPIRED` | 密码已过期 | 登录时 |

---

## 登录时的密码过期响应

当租户启用密码轮换且用户密码已过期时，`POST /api/auth/login` 返回：

```json
HTTP 403
{
  "error": "Password has expired",
  "code": "PASSWORD_EXPIRED",
  "data": {
    "password_changed_at": "2025-01-01T00:00:00.000Z",
    "expires_at": "2025-04-01T00:00:00.000Z"
  }
}
```

客户端应引导用户前往 `POST /api/auth/password/change-expired` 修改密码。
