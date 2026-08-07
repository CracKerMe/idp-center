# AI Native 高级能力实施方案

> **范围**：实时事件流 (#2)、智能前端 (#4)、图谱分析 (#5)、自愈运维 (#6)
>
> **前提**：四阶段实施方案已全部完成，本方案在此基础上增量建设。
>
> **技术栈约束**：Express + Drizzle ORM + PostgreSQL + ioredis + prom-client + React 19 + TanStack Router

---

## 目录

- [能力 2：实时事件流与响应式架构](#能力-2实时事件流与响应式架构)
- [能力 4：智能前端交互](#能力-4智能前端交互)
- [能力 5：图谱与关系分析](#能力-5图谱与关系分析)
- [能力 6：自愈与自治运维](#能力-6自愈与自治运维)
- [跨能力依赖与排期](#跨能力依赖与排期)

---

## 能力 2：实时事件流与响应式架构

### 2.0 目标

将当前的「请求 → 同步处理 → 响应」模式升级为「事件 → 多消费者并行处理」模式，
使风险评估、UEBA、审计、告警全部在事件产生的瞬间异步触发，而非等待夜间批处理。

### 2.1 事件总线基础设施

**新建 `server/services/event-bus.service.ts`**

```ts
// ── 核心类型 ──

export interface DomainEvent {
  id: string;               // crypto.randomUUID()
  type: EventType;          // 枚举值，见下
  tenantId: string;
  userId?: string;
  clientId?: string;
  timestamp: Date;
  payload: Record<string, unknown>;
  metadata: {
    ip?: string;
    userAgent?: string;
    requestId?: string;     // 复用已有的 request-id 中间件
    sessionId?: string;
  };
}

export type EventType =
  // 认证
  | 'auth.login.success'
  | 'auth.login.fail'
  | 'auth.login.blocked'
  | 'auth.logout'
  | 'auth.password.change'
  | 'auth.password.reset'
  // MFA
  | 'mfa.enroll'
  | 'mfa.challenge'
  | 'mfa.verify.success'
  | 'mfa.verify.fail'
  | 'mfa.recovery.used'
  // 令牌
  | 'token.issued'
  | 'token.refreshed'
  | 'token.revoked'
  | 'token.introspected'
  // 会话
  | 'session.created'
  | 'session.terminated'
  | 'session.risk.elevated'
  // 用户
  | 'user.created'
  | 'user.updated'
  | 'user.role.changed'
  | 'user.group.changed'
  | 'user.deactivated'
  // 客户端
  | 'client.created'
  | 'client.updated'
  // 风险
  | 'risk.scored'
  | 'risk.policy.matched'
  | 'risk.alert.triggered'
  // 系统
  | 'system.key.rotated'
  | 'system.job.completed'
  | 'system.health.degraded';

// ── 总线实现 ──

type EventHandler = (event: DomainEvent) => Promise<void>;

class EventBus {
  private handlers = new Map<EventType, EventHandler[]>();
  private globalHandlers: EventHandler[] = [];
  private redis: Redis | null = null;

  /** 本地处理器（进程内，零延迟） */
  on(type: EventType | '*', handler: EventHandler): void;

  /** 发布事件 — 先本地分发，再写入 Redis Stream */
  async emit(event: DomainEvent): Promise<void>;

  /** 启动 Redis Stream 消费者组（多副本时每实例一个消费者） */
  async startConsumer(groupName: string): Promise<void>;

  /** 健康检查：积压消息数 */
  async getBacklogSize(): Promise<number>;
}

export const eventBus = new EventBus();
```

**实现要点**：

1. **双层分发**：
   - 进程内：`handlers` Map 直接调用，零延迟
   - 跨进程：`XADD idp:events * type auth.login.success tenantId default ...`
   - 消费者组用 `XREADGROUP`，每实例一个 consumer name（取 `hostname + pid`）
   - 未配置 Redis 时退化为纯进程内（与已有的 cache.service 降级策略一致）

2. **消息持久化**：
   - Redis Stream `MAXLEN ~` 100,000（自动裁剪，防内存溢出）
   - 关键事件（`risk.alert.triggered`、`auth.login.blocked`）同时写入 `audit_logs` 表

3. **可靠性**：
   - 本地 handler 异常不阻塞事件发布（catch + logger.error）
   - Redis Stream 消费失败时 `XCLAIM` 重试，3 次后入死信队列 `idp:events:dlq`

4. **指标**：
   - `event_bus_publish_total{type}` Counter
   - `event_bus_consume_total{type, status}` Counter
   - `event_bus_backlog` Gauge（Redis Stream 长度）
   - `event_bus_handler_duration_seconds{type}` Histogram

**新建 `server/schema/events.ts`**（可选，用于事件溯源查询）：

```ts
export const eventStore = pgTable('event_store', {
  id: text('id').primaryKey(),
  type: text('type').notNull(),
  tenantId: text('tenant_id').notNull(),
  userId: text('user_id'),
  payload: text('payload').notNull(),     // JSON string
  metadata: text('metadata'),
  createdAt: timestamp('created_at').defaultNow(),
}, (t) => [
  index('idx_event_store_tenant_time').on(t.tenantId, t.createdAt),
  index('idx_event_store_type_time').on(t.type, t.createdAt),
  index('idx_event_store_user').on(t.userId, t.createdAt),
]);
```

### 2.2 事件发射点接入

在现有代码的关键路径中插入 `eventBus.emit()` 调用：

| 文件 | 新增事件 | 接入位置 |
|---|---|---|
| `server/routes/auth.ts` | `auth.login.success/fail/blocked` | 登录处理函数末尾 |
| `server/routes/auth.ts` | `auth.password.change/reset` | 密码修改/重置成功后 |
| `server/routes/auth.ts` | `auth.logout` | 登出处理 |
| `server/routes/mfa.ts` | `mfa.enroll/challenge/verify.*` | MFA 操作各分支 |
| `server/oauth/issue.ts` | `token.issued/refreshed` | 签发令牌后 |
| `server/routes/user.ts` | `user.created/updated/deactivated` | 用户 CRUD |
| `server/routes/admin.ts` | `user.role.changed/group.changed` | RBAC 变更 |
| `server/services/risk.service.ts` | `risk.scored/policy.matched` | 风险评估完成后 |
| `server/jobs/scheduler.ts` | `system.job.completed` | 定时任务完成后 |

**接入代码模式**（统一）：

```ts
// 在事件发生后、返回响应前
await eventBus.emit({
  id: crypto.randomUUID(),
  type: 'auth.login.success',
  tenantId: req.tenantId,
  userId: user.id,
  timestamp: new Date(),
  payload: { method: 'password', mfaUsed: !!otpVerified },
  metadata: { ip: req.ip, userAgent: req.headers['user-agent'], requestId: req.requestId },
});
```

### 2.3 实时消费者：流式 UEBA

**新建 `server/services/stream-ueba.service.ts`**

替代现有的「夜间批处理 + 登录时增量更新」模式为滑动窗口实时聚合：

```ts
/**
 * 滑动窗口统计器 — 基于 Redis Sorted Set
 *
 * key:   ueba:window:{userId}:{metric}
 * score: event timestamp (ms)
 * member: eventId
 *
 * 通过 ZREMRANGEBYSCORE 清理过期数据，ZCARD 取计数。
 */

interface WindowConfig {
  windowMs: number;      // 窗口大小
  threshold: number;     // 触发阈值
  action: 'alert' | 'block' | 'step_up';
}

const WINDOWS: Record<string, WindowConfig> = {
  'login_fail_5min':   { windowMs: 5 * 60_000,   threshold: 5,  action: 'alert' },
  'login_fail_1hour':  { windowMs: 60 * 60_000,  threshold: 10, action: 'step_up' },
  'geo_jump_10min':    { windowMs: 10 * 60_000,  threshold: 2,  action: 'block' },
  'new_device_1hour':  { windowMs: 60 * 60_000,  threshold: 3,  action: 'alert' },
  'mfa_fail_15min':    { windowMs: 15 * 60_000,  threshold: 3,  action: 'block' },
};
```

**检测逻辑**：

1. **登录失败突增**：收到 `auth.login.fail` → 写入 `login_fail_5min` 窗口 → `ZCARD` 超阈值 → 触发 `risk.alert.triggered`
2. **地理跳跃**：收到 `auth.login.success` → 取上次成功登录的 `(lat, lon, timestamp)` → 计算距离/时间 → 速度 > 900km/h → 触发 `geo_jump_10min`
3. **设备突变**：同上，设备指纹变化频率超阈值
4. **MFA 暴力破解**：收到 `mfa.verify.fail` → 写入 `mfa_fail_15min` → 超阈值 → 锁定账户

**与现有 UEBA Job 的关系**：
- `stream-ueba.service.ts`：**实时层**，检测短期突发异常（5 分钟 ~ 1 小时窗口）
- `ueba.job.ts`：**离线层**，保留用于长期基线重算（90 天行为画像）
- 两层共享 `user_behavior_baselines` 表

### 2.4 实时消费者：智能告警

**新建 `server/services/alert.service.ts`**

```ts
export interface Alert {
  id: string;
  tenantId: string;
  severity: 'info' | 'low' | 'medium' | 'high' | 'critical';
  category: 'auth' | 'risk' | 'compliance' | 'system';
  title: string;
  description: string;
  sourceEventId: string;
  userId?: string;
  status: 'open' | 'acknowledged' | 'resolved' | 'false_positive';
  metadata: Record<string, unknown>;
  createdAt: Date;
}

export class AlertService {
  async create(alert: Omit<Alert, 'id' | 'status' | 'createdAt'>): Promise<Alert>;
  private async enrichWithAI(alert: Alert): Promise<string>;
  private async notify(alert: Alert): Promise<void>;
  private pushToSSE(alert: Alert): void;
}
```

**告警分级规则**：

| 事件模式 | 严重度 | 自动响应 |
|---|---|---|
| 单次登录失败 | info | 无 |
| 5 分钟内 5+ 次失败 | low | 通知 |
| 不可能旅行检测 | medium | 强制 MFA |
| 同一 IP 10+ 账户失败 | high | 临时封禁 IP |
| 已确认的账户接管 | critical | 锁定账户 + 通知管理员 |

### 2.5 SSE 端点

**新建 `server/routes/events.ts`**

```ts
/**
 * GET /api/events/stream
 *
 * Server-Sent Events 端点，前端实时接收告警和风险事件。
 * 认证：Bearer token（复用 authenticateUser 中间件）。
 * 租户隔离：只推送当前用户所属租户的事件。
 */
router.get('/stream', authenticateUser, (req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
  });

  const unsubscribe = alertService.subscribe(tenantId, userId, isAdmin, (alert) => {
    res.write(`event: alert\ndata: ${JSON.stringify(alert)}\n\n`);
  });

  const heartbeat = setInterval(() => res.write(': heartbeat\n\n'), 30_000);

  req.on('close', () => {
    clearInterval(heartbeat);
    unsubscribe();
  });
});
```

### 2.6 Schema 变更

```sql
CREATE TABLE event_store (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  tenant_id TEXT NOT NULL,
  user_id TEXT,
  payload TEXT NOT NULL,
  metadata TEXT,
  created_at TIMESTAMP DEFAULT NOW()
);
CREATE INDEX idx_event_store_tenant_time ON event_store(tenant_id, created_at);
CREATE INDEX idx_event_store_type_time ON event_store(type, created_at);

CREATE TABLE alerts (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  severity TEXT NOT NULL DEFAULT 'info',
  category TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  source_event_id TEXT,
  user_id TEXT,
  status TEXT NOT NULL DEFAULT 'open',
  metadata TEXT,
  created_at TIMESTAMP DEFAULT NOW(),
  resolved_at TIMESTAMP,
  resolved_by TEXT,
  resolution_note TEXT
);
CREATE INDEX idx_alerts_tenant_status ON alerts(tenant_id, status);
CREATE INDEX idx_alerts_created ON alerts(created_at DESC);

CREATE TABLE alert_deliveries (
  id TEXT PRIMARY KEY,
  alert_id TEXT NOT NULL REFERENCES alerts(id),
  channel TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  attempts INTEGER DEFAULT 0,
  last_error TEXT,
  delivered_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW()
);

ALTER TABLE user_behavior_baselines
  ADD COLUMN realtime_flags TEXT;

ALTER TABLE login_events
  ADD COLUMN event_id TEXT;
```

### 2.7 新增环境变量

```env
EVENT_STORE_ENABLED=false
EVENT_STREAM_MAXLEN=100000
EVENT_CONSUMER_GROUP=idp-workers
ALERT_WEBHOOK_URL=
ALERT_AI_ENRICHMENT=false
ALERT_RATE_LIMIT_PER_MINUTE=10
```

---

## 能力 4：智能前端交互

### 4.0 目标

在管理后台中引入 AI 驱动的自然语言查询、智能搜索、增强型仪表盘。

### 4.1 后端：AI 查询引擎

**新建 `server/services/ai-query.service.ts`**

```ts
/**
 * 自然语言 → 结构化查询 → 执行 → 结果格式化
 *
 * 安全约束：
 * 1. 只生成 SELECT 查询，绝不生成 INSERT/UPDATE/DELETE
 * 2. 自动注入 tenant_id 过滤条件
 * 3. 查询结果上限 100 行
 * 4. 所有生成的 SQL 经过白名单校验
 */

export interface AIQueryResult {
  answer: string;
  data?: unknown[];
  query?: string;
  visualization?: ChartSpec;
  confidence: number;
}

export interface ChartSpec {
  type: 'table' | 'bar' | 'line' | 'pie' | 'heatmap' | 'timeline';
  xAxis?: string;
  yAxis?: string;
  groupBy?: string;
  title: string;
}

export async function executeNaturalLanguageQuery(
  tenantId: string,
  question: string,
  isAdmin: boolean,
): Promise<AIQueryResult>;
```

**查询管线**：

```
用户输入 → LLM 意图解析 → SQL 生成 → 安全校验 → 执行 → 结果 → LLM 格式化回答
```

**安全校验层**：

```ts
function validateGeneratedSQL(sql: string, tenantId: string): string {
  const normalized = sql.trim().toLowerCase();
  if (!normalized.startsWith('select')) throw new Error('Only SELECT allowed');

  const FORBIDDEN = ['insert', 'update', 'delete', 'drop', 'alter', 'truncate',
                      'create', 'grant', 'revoke', 'exec', 'execute', '--', ';'];
  for (const kw of FORBIDDEN) {
    if (normalized.includes(kw)) throw new Error(`Forbidden keyword: ${kw}`);
  }

  if (!normalized.includes('tenant_id')) {
    sql = injectTenantFilter(sql, tenantId);
  }
  if (!normalized.includes('limit')) {
    sql = sql.replace(/;?\s*$/, ' LIMIT 100;');
  }
  return sql;
}
```

### 4.2 后端：全局搜索

**新建 `server/services/search.service.ts`**

```ts
export interface SearchResult {
  type: 'user' | 'client' | 'tenant' | 'audit' | 'alert' | 'event';
  id: string;
  title: string;
  subtitle: string;
  url: string;
  score: number;
  highlights: string[];
}

export async function globalSearch(
  tenantId: string,
  query: string,
  options?: { types?: SearchResult['type'][]; limit?: number; isAdmin?: boolean },
): Promise<SearchResult[]>;
```

**搜索策略**：
1. 精确匹配：ID、邮箱、client_id
2. 前缀匹配：用户名、租户名
3. 模糊匹配：ILIKE '%query%'
4. 向量搜索（可选，需 pgvector）

### 4.3 后端：API 端点

```
POST /api/admin/ai/query
  Body: { question: string, context?: string }
  Response: AIQueryResult

GET /api/admin/ai/query/suggestions
  Response: string[]  // 预置常见问题

GET /api/search?q=&types=&limit=20
  Response: SearchResult[]

GET /api/admin/risk/dashboard/enhanced
  Response: {
    summary: { todayAlerts, highRiskUsers, mfaCoveragePercent, averageRiskScore, trends },
    signalDistribution: { code, count, percent }[],
    recentAlerts: Alert[],
    aiSummary?: string,
  }
```

### 4.4 前端：AI 查询组件

**新建 `src/components/ai/AIQueryBox.tsx`**

```tsx
/**
 * AI 查询对话框 — 嵌入管理后台全局
 *
 * 特性：
 * - 自然语言输入，支持中英文
 * - 实时流式响应（SSE）
 * - 结果可视化：表格/图表自动选择
 * - 查询历史记录
 * - 快捷问题建议
 */

interface Message {
  role: 'user' | 'assistant';
  content: string;
  data?: unknown[];
  chart?: ChartSpec;
  timestamp: Date;
}

export function AIQueryBox() {
  // 状态：messages, isStreaming, suggestions
  // 交互：输入框 + 发送按钮 + 快捷问题 chips
  // 展示：消息列表 + 数据可视化区
}
```

**UI 布局**：

```
┌─────────────────────────────────────────────┐
│  🤖 AI 助手                                  │
│                                              │
│  ┌─ 快捷问题 ─────────────────────────────┐ │
│  │ [过去7天被拦截的用户] [MFA覆盖率]       │ │
│  │ [异常登录IP] [高危告警]                 │ │
│  └─────────────────────────────────────────┘ │
│                                              │
│  ┌─ 对话区 ────────────────────────────────┐ │
│  │ 用户: 过去7天有哪些用户被风控拦截？      │ │
│  │                                         │ │
│  │ AI: 过去 7 天共有 23 个用户被风控拦截，  │ │
│  │     主要原因如下：                       │ │
│  │     - 不可能旅行检测: 12 次             │ │
│  │     - 新设备 + 异常时段: 8 次           │ │
│  │     - 连续失败超限: 3 次                │ │
│  │                                         │ │
│  │ ┌─────────────────────────────────┐     │ │
│  │ │ 用户名 │ IP │ 国家 │ 原因 │ 时间│     │ │
│  │ │ ...    │ ...│ ...  │ ...  │ ... │     │ │
│  │ └─────────────────────────────────┘     │ │
│  └─────────────────────────────────────────┘ │
│                                              │
│  ┌─ 输入框 ────────────────────────────────┐ │
│  │ 输入你的问题...              [发送 ➤]   │ │
│  └─────────────────────────────────────────┘ │
└─────────────────────────────────────────────┘
```

### 4.5 前端：增强风险仪表盘

**重写 `src/pages/admin/RiskDashboard.tsx`**

```
┌──────────┬──────────┬──────────┬──────────┐
│ 今日告警 │ 高风险用户│ MFA覆盖  │ 平均风险分│
│   12     │    5     │  67%     │   34     │
├──────────┴──────────┴──────────┴──────────┤
│           风险事件时间线（可交互）          │
├──────────────────────┬────────────────────┤
│   信号分布饼图        │   风险趋势折线图    │
├──────────────────────┴────────────────────┤
│           AI 生成的安全摘要                 │
├───────────────────────────────────────────┤
│           高危告警列表                      │
└───────────────────────────────────────────┘
```

### 4.6 前端：全局搜索

**新建 `src/components/search/GlobalSearch.tsx`**

- 快捷键触发（Cmd+K / Ctrl+K）
- 即时搜索结果（防抖 300ms）
- 分类标签：用户 / 客户端 / 审计 / 告警
- 键盘导航（↑↓ 选择，Enter 跳转）

### 4.7 前端：实时告警面板

**新建 `src/components/alerts/AlertPanel.tsx`**

```tsx
/**
 * 实时告警面板 — 使用 SSE 连接
 */
export function AlertPanel() {
  const { alerts, isConnected } = useAlertStream();
  // 筛选、列表、详情展开、确认/解决操作
}
```

**SSE Hook**：

```tsx
// src/hooks/useAlertStream.ts
export function useAlertStream() {
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [isConnected, setIsConnected] = useState(false);

  useEffect(() => {
    const es = new EventSource('/api/events/stream');
    es.onopen = () => setIsConnected(true);
    es.onerror = () => setIsConnected(false);
    es.addEventListener('alert', (e) => {
      setAlerts(prev => [JSON.parse(e.data), ...prev].slice(0, 100));
    });
    return () => es.close();
  }, []);

  return { alerts, isConnected };
}
```

### 4.8 新增依赖

```json
{
  "dependencies": {
    "recharts": "^2.x",
    "react-markdown": "^9.x"
  }
}
```

---

## 能力 5：图谱与关系分析

### 5.0 目标

在现有扁平表结构之上建立关系图谱查询层，用 PostgreSQL 递归 CTE 实现，
不引入图数据库。

### 5.1 核心图模型

```
节点类型：
  User       → users 表
  Client     → clients 表
  Role       → roles 表
  Group      → groups 表
  Permission → permissions 表
  Device     → login_events.device_fingerprint（聚合）
  IP         → login_events.ip（聚合）
  Location   → login_events.(country, city)（聚合）

边类型：
  User -[HAS_ROLE]→ Role
  User -[BELONGS_TO]→ Group
  Group -[HAS_ROLE]→ Role
  Role -[HAS_PERMISSION]→ Permission
  User -[USES_DEVICE]→ Device
  User -[LOGINS_FROM]→ IP
  User -[LINKED_ACCOUNT]→ ExternalIdP
```

### 5.2 图查询服务

**新建 `server/services/graph.service.ts`**

```ts
export interface GraphNode {
  id: string;
  type: 'user' | 'client' | 'role' | 'group' | 'permission' | 'device' | 'ip';
  label: string;
  properties: Record<string, unknown>;
}

export interface GraphEdge {
  source: string;
  target: string;
  type: string;
  properties: Record<string, unknown>;
}

export interface GraphResult {
  nodes: GraphNode[];
  edges: GraphEdge[];
  paths?: GraphPath[];
}

export interface GraphPath {
  nodes: string[];
  edges: string[];
  description: string;
}
```

### 5.3 核心查询函数

#### 5.3.1 权限路径分析

```ts
/**
 * "用户 A 如何获得对资源 X 的访问权限？"
 *
 * 路径：User → Role → Permission
 *       User → Group → Role → Permission
 *
 * 基于 PostgreSQL 递归 CTE，深度限制 5 层
 */
export async function findPermissionPaths(
  tenantId: string, userId: string, permissionCode: string,
): Promise<GraphPath[]>;
```

#### 5.3.2 影响分析

```ts
/**
 * "如果移除角色 R，哪些用户会受影响？"
 * 返回：直接用户、间接用户（通过组）、受影响权限、风险等级
 */
export async function analyzeRoleRemovalImpact(
  tenantId: string, roleId: string,
): Promise<{
  directUsers: GraphNode[];
  indirectUsers: GraphNode[];
  affectedPermissions: GraphNode[];
  riskLevel: 'low' | 'medium' | 'high';
}>;

/**
 * "如果用户 U 离开组 G，哪些权限会丢失？"
 */
export async function analyzeGroupRemovalImpact(
  tenantId: string, userId: string, groupId: string,
): Promise<{
  lostPermissions: GraphNode[];
  retainedViaOtherPaths: GraphNode[];
}>;
```

#### 5.3.3 最小权限差距分析

```ts
/**
 * 对比用户实际使用 vs 角色授予的权限
 * 输出：未使用的权限（可回收）+ 未授权的访问（异常！）
 */
export async function findLeastPrivilegeGap(
  tenantId: string, userId: string, lookbackDays?: number,
): Promise<{
  usedPermissions: string[];
  grantedPermissions: string[];
  unusedPermissions: string[];
  ungrantedAccess: string[];
}>;
```

#### 5.3.4 欺诈环检测

```ts
/**
 * 检测共享设备/IP 的账户聚类
 *
 * 算法：构建设备-用户二部图 → 找共享 2+ 设备的用户对 → 检测环形模式
 */
export async function detectFraudRings(
  tenantId: string,
  options?: { minSharedDevices?: number; minRingSize?: number; lookbackDays?: number },
): Promise<Array<{
  users: GraphNode[];
  sharedDevices: GraphNode[];
  sharedIPs: GraphNode[];
  riskScore: number;
  pattern: 'device_sharing' | 'ip_sharing' | 'mixed';
}>>;

/**
 * 注册行为聚类检测
 * 模式：同 IP 批量注册 / 邮箱模式相似 / 注册后行为一致
 */
export async function detectRegistrationClusters(
  tenantId: string, lookbackDays?: number,
): Promise<Array<{
  users: GraphNode[];
  clusterType: 'ip_batch' | 'email_pattern' | 'behavioral';
  confidence: number;
}>>;
```

#### 5.3.5 横向移动检测

```ts
/**
 * 检测同一设备/IP 上的异常账户切换序列
 */
export async function detectLateralMovement(
  tenantId: string, lookbackHours?: number,
): Promise<Array<{
  sourceUser: GraphNode;
  targetUser: GraphNode;
  pivotPoint: GraphNode;
  timeline: Array<{ timestamp: Date; action: string; userId: string }>;
  riskScore: number;
}>>;
```

### 5.4 图谱 API

```
GET /api/admin/graph/permissions/:userId          → 权限关系图
GET /api/admin/graph/role-impact/:roleId           → 角色移除影响
GET /api/admin/graph/fraud-rings                   → 欺诈环检测
GET /api/admin/graph/lateral-movement              → 横向移动检测
GET /api/admin/graph/least-privilege/:userId       → 最小权限差距
GET /api/admin/graph/network?center=userId&depth=3 → 关系网络
```

### 5.5 前端：图谱可视化

**新建 `src/components/graph/GraphVisualizer.tsx`**

```tsx
/**
 * 交互式关系图谱 — SVG + 力导向布局
 * 节点拖拽、点击展开、类型着色、路径高亮、缩放平移
 */
interface GraphVisualizerProps {
  data: GraphResult;
  centerNodeId?: string;
  onNodeClick?: (node: GraphNode) => void;
  highlightPath?: string[];
  layout?: 'force' | 'tree' | 'radial';
}
```

**新建 `src/pages/admin/GraphExplorer.tsx`**

```
┌─────────────────────────────────────────────┐
│ 🔍 搜索用户/角色/组...    [深度: 3 ▼]      │
├──────────┬──────────────────────────────────┤
│ 节点详情  │        图谱可视化区域             │
│          │     ○───●───○                    │
│ 用户: A  │    / \   |                        │
│ 角色: .. │   ○   ○──●───○                   │
├──────────┼──────────────────────────────────┤
│ 快捷分析  │  [权限路径] [影响分析] [欺诈环]   │
│          │  [最小权限] [横向移动]             │
└──────────┴──────────────────────────────────┘
```

### 5.6 物化视图（性能优化）

```sql
-- 用户-设备关系（每小时刷新）
CREATE MATERIALIZED VIEW mv_user_devices AS
SELECT user_id, device_fingerprint, COUNT(*) AS usage_count,
       MAX(created_at) AS last_used, ARRAY_AGG(DISTINCT country) AS countries
FROM login_events
WHERE outcome = 'success' AND created_at > NOW() - INTERVAL '90 days'
  AND device_fingerprint IS NOT NULL
GROUP BY user_id, device_fingerprint;

CREATE INDEX idx_mv_user_devices_user ON mv_user_devices(user_id);
CREATE INDEX idx_mv_user_devices_device ON mv_user_devices(device_fingerprint);

-- 用户-IP 关系（每小时刷新）
CREATE MATERIALIZED VIEW mv_user_ips AS
SELECT user_id, ip, COUNT(*) AS usage_count,
       MAX(created_at) AS last_used, ARRAY_AGG(DISTINCT country) AS countries
FROM login_events
WHERE outcome = 'success' AND created_at > NOW() - INTERVAL '90 days'
GROUP BY user_id, ip;

CREATE INDEX idx_mv_user_ips_user ON mv_user_ips(user_id);
CREATE INDEX idx_mv_user_ips_ip ON mv_user_ips(ip);

-- 刷新：挂到 scheduler.ts，每小时 REFRESH MATERIALIZED VIEW CONCURRENTLY
```

---

## 能力 6：自愈与自治运维

### 6.0 目标

建立系统的自我监控、自我诊断、自我修复能力。

### 6.1 系统自检框架

**新建 `server/services/health-checker.service.ts`**

```ts
/**
 * 深度健康检查 — /healthz 端点
 *
 * 评分维度（满分 100）：
 * - 数据库 (25): 连接池、查询延迟、复制延迟
 * - 缓存 (15): Redis 连通性、内存、命中率
 * - 事件总线 (15): 积压、延迟
 * - 业务指标 (20): 登录失败率、令牌刷新率、告警积压
 * - 安全 (15): 密钥新鲜度、GeoIP 年龄、限流命中率
 * - 系统 (10): 磁盘、内存、事件循环延迟
 */

export interface HealthCheckResult {
  score: number;
  status: 'healthy' | 'degraded' | 'unhealthy';
  checks: HealthCheckItem[];
  recommendations: string[];
  timestamp: Date;
}

export interface HealthCheckItem {
  name: string;
  status: 'pass' | 'warn' | 'fail';
  value: number | string;
  threshold: number | string;
  message: string;
  autoHeal?: string;
}
```

**检查项**：

| 维度 | 检查项 | 告警阈值 |
|---|---|---|
| 数据库 | 连接池使用率 | > 80% warn, > 95% fail |
| 数据库 | P95 查询延迟 | > 100ms warn, > 500ms fail |
| Redis | 连通性 | 断开 = fail |
| Redis | 内存使用 | > 80% warn |
| 事件总线 | 积压消息数 | > 1000 warn, > 10000 fail |
| 业务 | 登录失败率（5 分钟） | > 20% warn, > 50% fail |
| 安全 | 签名密钥年龄 | > 80 天 warn, > 90 天 fail |
| 安全 | GeoIP 数据库年龄 | > 30 天 warn, > 60 天 fail |
| 系统 | 内存使用 | > 80% warn, > 90% fail |
| 系统 | 事件循环延迟 | > 200ms warn, > 500ms fail |

**API**：

```
GET /api/health/comprehensive → HealthCheckResult
GET /api/health/history?hours=24 → 健康评分历史
```

### 6.2 自动修复引擎

**新建 `server/services/auto-heal.service.ts`**

```ts
export interface HealRule {
  id: string;
  name: string;
  condition: (metrics: HealthMetrics) => boolean;
  action: HealAction;
  cooldownMs: number;
  maxExecutions: number;
  requiresConfirmation: boolean;
  enabled: boolean;
}

export type HealAction =
  | { type: 'clear_cache'; target: string }
  | { type: 'block_ip'; ip: string; durationMs: number }
  | { type: 'unlock_account'; userId: string }
  | { type: 'send_alert'; severity: string; message: string }
  | { type: 'log_only'; message: string };
```

**预置修复规则**：

| 规则 | 条件 | 动作 | 冷却 | 需确认 |
|---|---|---|---|---|
| 事件总线积压清理 | backlog > 10,000 | 清理死信队列 | 5 min | ✅ |
| 登录失败率突增 | failureRate > 30% | 告警通知 | 5 min | ❌ |
| GeoIP 数据库过期 | age > 30 天 | 下载更新 | 24 hr | ❌ |
| 事件循环延迟 | lag > 500ms | 告警通知 | 10 min | ❌ |
| 内存使用过高 | usage > 90% | 告警通知 | 10 min | ❌ |

**设计原则**：
1. 所有修复操作有审计日志
2. 修复可配置开关
3. 修复失败时通知人工
4. 冷却期防止反复触发

### 6.3 自适应阈值

**新建 `server/services/adaptive-threshold.service.ts`**

```ts
/**
 * 基于历史分布动态调整告警阈值
 * 算法：EWMA + 标准差 + 按星期/小时分桶的季节性调整
 */

export interface AdaptiveThreshold {
  metric: string;
  currentValue: number;
  baseline: number;
  stddev: number;
  upperBound: number;  // baseline + 3σ
  lowerBound: number;  // baseline - 3σ
  isAnomaly: boolean;
  confidence: number;
  updatedAt: Date;
}

export async function calculateAdaptiveThreshold(
  tenantId: string, metric: string, lookbackDays?: number,
): Promise<AdaptiveThreshold>;
```

**自适应指标**：

| 指标 | 当前静态值 | 自适应方式 |
|---|---|---|
| 登录失败率告警 | 无 | EWMA + 3σ |
| 风险分数分布 | 固定 policy bands | 基于历史分位数 |
| UEBA 窗口阈值 | 固定 5 次/5 分钟 | 基于用户历史行为 |
| 告警频率上限 | 固定 10/min | 基于历史告警密度 |

### 6.4 运行手册自动化

**新建 `server/services/runbook.service.ts`**

```ts
export interface Runbook {
  id: string;
  name: string;
  description: string;
  trigger: 'manual' | 'alert' | 'scheduled';
  steps: RunbookStep[];
  rollbackSteps?: RunbookStep[];
  estimatedDuration: string;
  riskLevel: 'low' | 'medium' | 'high';
}

export interface RunbookStep {
  name: string;
  action: () => Promise<void>;
  verify: () => Promise<boolean>;
  rollback?: () => Promise<void>;
}
```

**预置运行手册**：

| 手册 | 触发方式 | 步骤 | 风险 |
|---|---|---|---|
| 紧急密钥轮换 | 手动 | 生成 → 发布 JWKS → 等缓存 → 激活 → 废弃旧 | high |
| IP 临时封禁 | 告警 | 加黑名单 → 撤销会话 → 通知用户 | medium |
| 账户紧急锁定 | 告警 | 锁定 → 撤销令牌 → 禁恢复码 → 邮件 → 记录 | high |

### 6.5 容量预测

**新建 `server/services/capacity-planner.service.ts`**

```ts
/**
 * 基于历史趋势预测资源需求
 * 算法：EWMA + 线性趋势外推（手写约 100 行，无需 ML 库）
 */

export interface CapacityForecast {
  metric: string;
  currentValue: number;
  predictions: Array<{
    date: Date;
    predicted: number;
    lower: number;
    upper: number;
  }>;
  recommendedAction?: string;
  estimatedExhaustion?: Date;
}
```

**可预测指标**：数据库存储量、日活用户、每日令牌签发量、审计日志量、Redis 内存

### 6.6 API 与前端

**API**：

```
GET  /api/admin/ops/health/comprehensive     → 健康评分
GET  /api/admin/ops/health/history?hours=24   → 健康历史
GET  /api/admin/ops/auto-heal/log?hours=24    → 修复日志
GET  /api/admin/ops/auto-heal/rules           → 修复规则
PUT  /api/admin/ops/auto-heal/rules/:id       → 更新规则
GET  /api/admin/ops/thresholds                → 自适应阈值
GET  /api/admin/ops/capacity/:metric?days=90  → 容量预测
GET  /api/admin/ops/runbooks                  → 运行手册
POST /api/admin/ops/runbooks/:id/execute      → 执行手册
```

**前端 `src/pages/admin/OperationsCenter.tsx`**：

```
┌─────────────────────────────────────────────┐
│ 系统健康评分: 87/100 [健康 ✓]               │
├─────────────────────────────────────────────┤
│ ✅ PostgreSQL      连接池 8/10    正常       │
│ ✅ Redis           内存 45%       正常       │
│ ⚠️ 事件总线        积压 1,234     警告       │
│ ❌ GeoIP 数据库    过期 35 天     需更新      │
├─────────────────────────────────────────────┤
│ 自动修复日志                                  │
│ ✅ [09:15] Redis 断线重连                    │
│ ⚠️ [14:30] 事件总线积压清理（等待确认）       │
├─────────────────────────────────────────────┤
│ 容量预测                                     │
│ [数据库存储量趋势图]  预计 45 天后需扩容       │
├─────────────────────────────────────────────┤
│ 运行手册                                     │
│ [紧急密钥轮换] [IP封禁] [账户锁定]           │
└─────────────────────────────────────────────┘
```

### 6.7 Schema 变更

```sql
CREATE TABLE health_check_history (
  id TEXT PRIMARY KEY,
  score INTEGER NOT NULL,
  status TEXT NOT NULL,
  checks TEXT NOT NULL,
  recommendations TEXT,
  created_at TIMESTAMP DEFAULT NOW()
);
CREATE INDEX idx_health_history_time ON health_check_history(created_at DESC);

CREATE TABLE auto_heal_log (
  id TEXT PRIMARY KEY,
  rule_id TEXT NOT NULL,
  rule_name TEXT NOT NULL,
  action_type TEXT NOT NULL,
  action_params TEXT,
  status TEXT NOT NULL,
  error TEXT,
  executed_at TIMESTAMP DEFAULT NOW(),
  executed_by TEXT DEFAULT 'system'
);
CREATE INDEX idx_auto_heal_log_time ON auto_heal_log(executed_at DESC);

CREATE TABLE adaptive_thresholds (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  metric TEXT NOT NULL,
  baseline REAL NOT NULL,
  stddev REAL NOT NULL,
  upper_bound REAL NOT NULL,
  lower_bound REAL NOT NULL,
  updated_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(tenant_id, metric)
);

CREATE TABLE runbook_executions (
  id TEXT PRIMARY KEY,
  runbook_id TEXT NOT NULL,
  status TEXT NOT NULL,
  current_step INTEGER DEFAULT 0,
  steps_log TEXT,
  triggered_by TEXT NOT NULL,
  started_at TIMESTAMP DEFAULT NOW(),
  completed_at TIMESTAMP
);

CREATE TABLE capacity_forecasts (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  metric TEXT NOT NULL,
  predictions TEXT NOT NULL,
  computed_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(tenant_id, metric)
);
```

### 6.8 新增环境变量

```env
AUTO_HEAL_ENABLED=true
AUTO_HEAL_TICK_INTERVAL_MS=60000
HEALTH_CHECK_INTERVAL_MS=30000
HEALTH_HISTORY_RETENTION_DAYS=30
ADAPTIVE_THRESHOLD_REFRESH_HOURS=6
CAPACITY_FORECAST_ENABLED=true
```

---

## 跨能力依赖与排期

### 依赖关系

```
能力 2（事件流）
  ├── 2.1 事件总线 ──────────────┐
  ├── 2.3 流式 UEBA              ├──→ 能力 4（智能前端）
  ├── 2.4 智能告警               │     └── 4.7 实时告警面板
  └── 2.6 SSE 端点 ──────────────┘

能力 5（图谱）← 依赖现有 RBAC + 审计数据

能力 6（自愈）
  ├── 6.1 健康检查 ← 依赖 metrics.ts
  ├── 6.2 自动修复 ← 依赖 6.1 + 能力 2 事件总线
  └── 6.3 自适应阈值 ← 依赖历史数据
```

### 实施排期（12 周）

```
Phase 1（第 1-3 周）：基础设施
  ├── 2.1 事件总线基础设施
  ├── 2.2 事件发射点接入（核心路径）
  ├── 6.1 系统自检框架
  └── 6.7 Schema 变更（全部新表）

Phase 2（第 4-6 周）：核心能力
  ├── 2.3 流式 UEBA
  ├── 2.4 智能告警
  ├── 2.6 SSE 端点
  ├── 6.2 自动修复引擎
  └── 6.3 自适应阈值

Phase 3（第 7-9 周）：智能交互 + 图谱
  ├── 4.1 AI 查询引擎（后端）
  ├── 4.3 全局搜索（后端）
  ├── 5.2 图查询服务
  ├── 5.3 核心查询函数
  └── 5.6 物化视图

Phase 4（第 10-12 周）：前端交付
  ├── 4.4 AI 查询组件
  ├── 4.5 增强风险仪表盘
  ├── 4.6 全局搜索组件
  ├── 4.7 实时告警面板
  ├── 5.5 图谱可视化
  └── 6.6 运维中心页面
```

### 涉及文件清单

| 操作 | 文件 |
|---|---|
| 新建 | `server/services/event-bus.service.ts` |
| 新建 | `server/services/stream-ueba.service.ts` |
| 新建 | `server/services/alert.service.ts` |
| 新建 | `server/services/ai-query.service.ts` |
| 新建 | `server/services/search.service.ts` |
| 新建 | `server/services/graph.service.ts` |
| 新建 | `server/services/health-checker.service.ts` |
| 新建 | `server/services/auto-heal.service.ts` |
| 新建 | `server/services/adaptive-threshold.service.ts` |
| 新建 | `server/services/runbook.service.ts` |
| 新建 | `server/services/capacity-planner.service.ts` |
| 新建 | `server/routes/events.ts` |
| 新建 | `server/routes/ai-query.ts` |
| 新建 | `server/routes/graph.ts` |
| 新建 | `server/routes/operations.ts` |
| 新建 | `server/schema/events.ts` |
| 新建 | `src/components/ai/AIQueryBox.tsx` |
| 新建 | `src/components/search/GlobalSearch.tsx` |
| 新建 | `src/components/alerts/AlertPanel.tsx` |
| 新建 | `src/components/graph/GraphVisualizer.tsx` |
| 新建 | `src/hooks/useAlertStream.ts` |
| 新建 | `src/pages/admin/GraphExplorer.tsx` |
| 新建 | `src/pages/admin/OperationsCenter.tsx` |
| 新建 | `src/routes/admin/ai-query.tsx` |
| 新建 | `src/routes/admin/alerts.tsx` |
| 新建 | `src/routes/admin/graph.tsx` |
| 新建 | `src/routes/admin/operations.tsx` |
| 修改 | `server.ts`（挂载新路由、启动事件总线） |
| 修改 | `server/routes/auth.ts`（接入事件发射） |
| 修改 | `server/routes/mfa.ts`（接入事件发射） |
| 修改 | `server/routes/user.ts`（接入事件发射） |
| 修改 | `server/routes/admin.ts`（接入事件发射） |
| 修改 | `server/services/risk.service.ts`（接入事件发射） |
| 修改 | `server/jobs/scheduler.ts`（挂载健康检查、自动修复） |
| 修改 | `server/schema/index.ts`（导出新 schema） |
| 修改 | `src/pages/admin/RiskDashboard.tsx`（增强重写） |
| 修改 | `src/routes/admin/__root.tsx`（侧边栏新入口） |

### 新增依赖

```json
{
  "dependencies": {
    "recharts": "^2.x",
    "react-markdown": "^9.x"
  }
}
```

> 无需引入图数据库、消息队列、ML 框架等重型中间件。
> 全部基于现有 PostgreSQL + Redis + Express 栈实现。
