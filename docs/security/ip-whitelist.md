状态：active
范围：主应用 / 安全专题
最后核对：2026-08-07（核对结论：内容与代码一致，阶段三/四改动未涉及此模块，无需变更）
事实来源：server/middleware/ip-whitelist.ts, server/routes/admin.ts, server/database.ts, server.ts
替代文档：无

# IP 白名单（IP Whitelist）

## 概述

IP 白名单守卫（`IPWhitelistGuard`）在 P0 安全合规基座阶段实现，作为 Express 中间件在认证中间件之前执行，对所有 `/api` 请求进行租户级来源 IP 校验。

核心文件：
- `server/middleware/ip-whitelist.ts` — 中间件及 CIDR 匹配算法
- `server/routes/admin.ts` — 白名单管理 API
- `server/database.ts` — 数据表定义

---

## 数据库表

### `tenant_ip_whitelist`

存储每个租户的 IP 白名单条目，支持 IPv4 和 IPv6 CIDR 格式。

| 字段 | 类型 | 说明 |
|------|------|------|
| `id` | TEXT PK | UUID |
| `tenant_id` | TEXT | 外键 → `tenants(id)` |
| `cidr` | TEXT | CIDR 格式 IP 段，如 `192.168.1.0/24` 或 `::1/128` |
| `description` | TEXT | 可选描述，最长 255 字符 |
| `created_by` | TEXT | 创建者用户 ID |
| `created_at` | DATETIME | 创建时间 |

约束：`UNIQUE(tenant_id, cidr)` — 同一租户不允许重复 CIDR

索引：`idx_ip_whitelist_tenant ON tenant_ip_whitelist(tenant_id)`

---

## 中间件执行位置

在 `server.ts` 中，`ipWhitelistGuard` 注册在 `tenantContext` 之后、所有路由之前：

```
HTTP 请求
  → tenantContext（注入 req.tenantId）
  → ipWhitelistGuard（IP 校验）
  → authenticateToken / authenticateAdmin
  → 业务路由
```

这确保了未授权 IP 无法触达任何业务逻辑，包括认证端点。

---

## 访问控制逻辑

```
查询 tenant_ip_whitelist WHERE tenant_id = req.tenantId
  ├─ 无条目 → 全通（allow all）
  └─ 有条目 → 提取客户端 IP
               对所有条目执行逻辑或（OR）匹配
               ├─ 任意一条匹配 → 放行
               └─ 全部不匹配  → 403 IP_NOT_WHITELISTED + 写入审计日志
```

---

## 客户端 IP 提取

优先从 `X-Forwarded-For` 请求头提取第一个 IP（反向代理场景），回退到 `req.ip` 和 `req.socket.remoteAddress`：

```
X-Forwarded-For: 203.0.113.5, 10.0.0.1, 172.16.0.1
                 ↑ 取第一个（最原始的客户端 IP）
```

---

## CIDR 匹配算法

### IPv4（位运算）

```typescript
// 掩码计算
const mask = prefix === 0 ? 0 : (~0 << (32 - prefix)) >>> 0;
// 匹配判断
(ipInt & mask) === (networkInt & mask)
```

- `/0` 匹配所有地址
- `/32` 精确匹配单个地址

### IPv6（BigInt 运算）

先将简写形式展开为完整 8 组表示（`expandIpv6`），再转换为 128 位 BigInt 进行掩码比较：

```typescript
const mask = prefix === 0 ? 0n : (~0n << BigInt(128 - prefix));
(ipBig & mask) === (networkBig & mask)
```

- `/0` 匹配所有地址
- `/128` 精确匹配单个地址

### CIDR 格式校验（`parseCidr`）

返回 `{ ip, prefix, version: 4 | 6 }` 或 `null`（格式无效）。校验规则：
- 必须包含且仅包含一个 `/`
- 前缀必须为整数
- IPv4：前缀范围 0~32，IP 为合法点分十进制
- IPv6：前缀范围 0~128，IP 为合法 IPv6（支持 `::` 简写）

---

## 审计日志

当请求被拦截时，写入 `audit_logs` 表，`action = 'IP_BLOCKED'`，`details` 字段包含：

```json
{
  "blocked_ip": "203.0.113.99",
  "tenant_id": "acme-corp",
  "path": "/api/auth/login"
}
```

---

## 错误响应

```json
HTTP 403
{
  "error": "Access denied: IP not whitelisted",
  "code": "IP_NOT_WHITELISTED"
}
```

---

## 管理 API

白名单条目通过管理员 API 管理，详见 [IP 白名单 API 文档](../api/ip-whitelist-api.md)。

---

## 注意事项

- 白名单变更**立即生效**，无需重启服务（每次请求实时查询数据库）
- 租户无白名单条目时，所有 IP 均可通过，不执行任何校验
- 同一租户不允许添加重复 CIDR（数据库 UNIQUE 约束保证）
- IPv4 和 IPv6 CIDR 可以混合配置，中间件自动按 CIDR 版本分发匹配
