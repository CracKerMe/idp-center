状态：active
范围：主应用 / 安全专题
最后核对：2026-04-19
事实来源：server/services/password-policy.service.ts, server/utils/weak-passwords.ts, server/routes/auth.ts, server/database.ts
替代文档：无

# 密码策略（Password Policy）

## 概述

IDP Center 的密码策略模块（`PasswordPolicyEngine`）在 P0 安全合规基座阶段实现，替代了原有的 `validatePasswordStrength` 函数，提供完整的租户级密码策略执行能力。

核心文件：
- `server/services/password-policy.service.ts` — 策略引擎主体
- `server/utils/weak-passwords.ts` — 弱口令字典
- `server/database.ts` — 数据表定义

---

## 数据库表

### `tenant_password_policies`

存储每个租户的自定义密码策略配置。每个租户最多一条记录，无记录时使用系统默认值。

| 字段 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `id` | TEXT PK | — | UUID |
| `tenant_id` | TEXT UNIQUE | — | 租户 ID，外键 → `tenants(id)` |
| `min_length` | INTEGER | 8 | 最低密码长度（有效范围 6~128） |
| `history_count` | INTEGER | 5 | 禁止复用的历史密码条数（有效范围 1~24） |
| `rotation_enabled` | INTEGER | 0 | 是否启用密码轮换（0=否，1=是） |
| `rotation_period_days` | INTEGER | 90 | 轮换周期天数（有效范围 1~365） |
| `created_at` | DATETIME | CURRENT_TIMESTAMP | — |
| `updated_at` | DATETIME | CURRENT_TIMESTAMP | — |

### `password_history`

存储用户历史密码哈希，用于防止密码循环复用。

| 字段 | 类型 | 说明 |
|------|------|------|
| `id` | TEXT PK | UUID |
| `user_id` | TEXT | 外键 → `users(id)` |
| `tenant_id` | TEXT | 冗余存储，便于租户级清理 |
| `password_hash` | TEXT | bcrypt 哈希（cost factor 10） |
| `created_at` | DATETIME | 记录时间 |

索引：`idx_password_history_user ON password_history(user_id, created_at)`

---

## 系统默认策略

当租户无自定义配置时，使用以下默认值：

```typescript
export const DEFAULT_PASSWORD_POLICY = {
  min_length: 8,
  history_count: 5,
  rotation_enabled: false,
  rotation_period_days: 90,
};
```

---

## 密码校验链

`validatePassword(password, userId, tenantId)` 按以下顺序执行，**收集所有违规项后一次性返回**，不提前中断：

### 1. 强度校验（纯函数，无 I/O）

| 规则 | 错误码 |
|------|--------|
| 长度 < `min_length` | `PASSWORD_TOO_SHORT` |
| 不含大写字母 | `PASSWORD_MISSING_UPPERCASE` |
| 不含小写字母 | `PASSWORD_MISSING_LOWERCASE` |
| 不含数字 | `PASSWORD_MISSING_DIGIT` |
| 不含特殊符号（非字母数字字符） | `PASSWORD_MISSING_SPECIAL` |

### 2. 弱口令检测（大小写不敏感）

检查 `password.toLowerCase()` 是否在 `WeakPasswordDictionary` 中。

| 规则 | 错误码 |
|------|--------|
| 密码存在于弱口令字典 | `PASSWORD_TOO_COMMON` |

### 3. 历史密码比对（仅当 `userId !== null`）

查询该用户最近 `history_count` 条历史记录，逐一执行 `bcrypt.compareSync`。

| 规则 | 错误码 |
|------|--------|
| 与任意历史密码匹配 | `PASSWORD_RECENTLY_USED` |

---

## 弱口令字典

内置 185+ 条常见弱密码，全部小写存储，查找时间复杂度 O(1)。

支持通过环境变量 `WEAK_PASSWORDS_FILE` 指定自定义字典文件路径，在服务启动时合并（无需重启服务即可扩展，但需重启进程使文件变更生效）：

```env
WEAK_PASSWORDS_FILE=/etc/idp-center/custom-weak-passwords.txt
```

文件格式：每行一个密码，UTF-8 编码，空行自动忽略。

---

## 密码历史记录

`recordPasswordHistory(userId, passwordHash, tenantId)` 在密码变更成功后由业务层调用（不在 `validatePassword` 内部调用）：

1. INSERT 新记录
2. DELETE 超出 `history_count` 限制的旧记录（保留最新 N 条）

**调用时机**：
- 用户注册（`POST /api/auth/register`）
- 密码重置（`POST /api/auth/password/reset`）
- 过期密码修改（`POST /api/auth/password/change-expired`）

---

## 密码轮换（Password Rotation）

### 过期判断

`isPasswordExpired(passwordChangedAt, tenantId)` 在登录时调用：

- 若租户未启用轮换（`rotation_enabled = false`）：始终返回 `{ expired: false, expiresAt: null }`
- 若 `passwordChangedAt` 为 null 且轮换已启用：视为已过期
- 否则：`expiresAt = passwordChangedAt + rotation_period_days × 86400s`，与当前时间比较

### 登录时的过期拦截

在 `POST /api/auth/login` 中，密码验证通过、OTP 验证通过之后，生成 token 之前执行过期检查。若过期，返回：

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

### 过期密码修改端点

`POST /api/auth/password/change-expired` 允许密码已过期的用户在不完成完整登录流程的情况下修改密码（无需 `authenticateToken`，通过用户名 + 旧密码验证身份）。

详见 [密码策略 API 文档](../api/password-policy-api.md)。

---

## 错误响应格式

密码校验失败时，HTTP 400，响应体包含所有违规项：

```json
{
  "error": "Password does not meet requirements",
  "code": "VALIDATION_PASSWORD_WEAK",
  "details": [
    { "code": "PASSWORD_MISSING_UPPERCASE", "message": "密码必须包含至少一个大写字母" },
    { "code": "PASSWORD_MISSING_SPECIAL",   "message": "密码必须包含至少一个特殊符号" },
    { "code": "PASSWORD_TOO_SHORT",         "message": "密码长度不能少于 12 个字符" }
  ]
}
```

---

## 向后兼容

原有 `validatePasswordStrength`（`server/utils/password.ts`）已标记 `@deprecated`，保留原始实现以维持现有测试和 `/api/auth/password/validate` 端点的兼容性。新代码应使用 `validatePassword` from `server/services/password-policy.service.ts`。
