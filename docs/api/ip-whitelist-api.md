状态：active
范围：主应用 / API 契约
最后核对：2026-08-07（核对结论：内容与代码一致，阶段三/四改动未涉及此模块，无需变更）
事实来源：server/routes/admin.ts, server/validators/admin.validator.ts, server/middleware/ip-whitelist.ts
替代文档：无

# IP 白名单 API

## 概述

IP 白名单管理 API 挂载在 `/api/admin` 下，需要管理员鉴权。所有响应遵循统一格式 `{ code, data?, message?, error? }`，`code: 0` 表示成功。

---

## GET `/api/admin/tenants/:tenantId/ip-whitelist`

查询指定租户的所有 IP 白名单条目。

**鉴权**：`authenticateAdmin`

**响应 200**：

```json
{
  "code": 0,
  "data": [
    {
      "id": "550e8400-e29b-41d4-a716-446655440000",
      "cidr": "192.168.1.0/24",
      "description": "办公室网络",
      "created_by": "admin-user-id",
      "created_at": "2026-01-15T10:30:00.000Z"
    },
    {
      "id": "550e8400-e29b-41d4-a716-446655440001",
      "cidr": "10.0.0.0/8",
      "description": "内网段",
      "created_by": "admin-user-id",
      "created_at": "2026-01-15T11:00:00.000Z"
    }
  ]
}
```

> 无条目时返回空数组 `[]`。租户无白名单条目时，所有 IP 均可通过（全通策略）。

---

## POST `/api/admin/tenants/:tenantId/ip-whitelist`

添加 IP 白名单条目。

**鉴权**：`authenticateAdmin`

**请求体**：

```json
{
  "cidr": "10.0.0.0/8",
  "description": "内网段"
}
```

**字段约束**（Zod 校验）：

| 字段 | 类型 | 约束 |
|------|------|------|
| `cidr` | string | 非空，格式由 `parseCidr()` 验证 |
| `description` | string | 可选，最长 255 字符 |

**CIDR 格式要求**：
- IPv4：如 `192.168.1.0/24`、`10.0.0.1/32`（单主机）、`0.0.0.0/0`（全通）
- IPv6：如 `2001:db8::/32`、`::1/128`（单主机）、支持 `::` 简写

**响应 201**：

```json
{
  "code": 0,
  "data": { "id": "550e8400-e29b-41d4-a716-446655440002" },
  "message": "IP whitelist entry added"
}
```

**错误响应**：

| 状态码 | 错误码 | 原因 |
|--------|--------|------|
| 400 | `INVALID_CIDR_FORMAT` | CIDR 格式无效 |
| 409 | `CIDR_ALREADY_EXISTS` | 该租户已存在相同 CIDR |
| 401 | `AUTH_UNAUTHORIZED` | 未提供或无效的管理员 token |

---

## DELETE `/api/admin/tenants/:tenantId/ip-whitelist/:entryId`

删除指定 IP 白名单条目。

**鉴权**：`authenticateAdmin`

**路径参数**：
- `tenantId`：租户 ID
- `entryId`：条目 UUID（来自 GET 或 POST 响应的 `id` 字段）

**响应 200**：

```json
{
  "code": 0,
  "message": "IP whitelist entry removed"
}
```

**错误响应**：

| 状态码 | 错误码 | 原因 |
|--------|--------|------|
| 404 | `RESOURCE_NOT_FOUND` | 条目不存在或不属于该租户 |
| 401 | `AUTH_UNAUTHORIZED` | 未提供或无效的管理员 token |

> 删除后立即生效，后续请求按更新后的白名单执行校验。

---

## IP 白名单相关错误码

| 错误码 | HTTP 状态码 | 含义 |
|--------|-------------|------|
| `IP_NOT_WHITELISTED` | 403 | 来源 IP 不在白名单中（由中间件返回，非管理 API） |
| `INVALID_CIDR_FORMAT` | 400 | CIDR 格式无效 |
| `CIDR_ALREADY_EXISTS` | 409 | 该租户已存在相同 CIDR |

---

## 被拦截请求的响应

当 `IPWhitelistGuard` 拦截请求时（非管理 API，而是所有 `/api` 请求），返回：

```json
HTTP 403
{
  "error": "Access denied: IP not whitelisted",
  "code": "IP_NOT_WHITELISTED"
}
```

同时在 `audit_logs` 表写入一条 `action = 'IP_BLOCKED'` 的审计记录，`details` 包含：

```json
{
  "blocked_ip": "203.0.113.99",
  "tenant_id": "acme-corp",
  "path": "/api/auth/login"
}
```

---

## 典型使用场景

### 限制租户只允许办公室 IP 访问

```bash
# 添加办公室 IP 段
POST /api/admin/tenants/acme-corp/ip-whitelist
{ "cidr": "203.0.113.0/24", "description": "上海办公室" }

# 添加 VPN 出口 IP
POST /api/admin/tenants/acme-corp/ip-whitelist
{ "cidr": "198.51.100.5/32", "description": "企业 VPN 出口" }
```

配置后，`acme-corp` 租户下的所有 API 请求只允许来自这两个 IP 段，其他来源一律返回 403。

### 解除 IP 限制

删除该租户的所有白名单条目后，恢复全通策略（所有 IP 均可访问）。
