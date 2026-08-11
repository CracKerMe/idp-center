# IDP Center 企业级增强 —— 可实施方案

## Context

`ENTERPRISE-OAUTH-ANALYSIS-COMPLETE.md` 给出了一份差距分析（核心 OAuth 6/10、企业就绪 4/10），但只有结论没有实施路径。本方案把那份报告的四个阶段全部落成可编码的改造步骤：文件路径、Drizzle 表定义、函数签名、依赖、上线顺序与破坏性变更的排期。

**明确排除**：社交登录扩展（Google/微信/钉钉等）。现有 GitHub 登录保留不动，但第二阶段会把它抽象成通用 IdP 框架 —— 后续接社交登录只是加配置，不在本方案交付范围内。

**自用部署姿态（gate, don't delete）**：本方案功能远超自用需求，因此采用"关闭暴露面，不删代码"的原则。以下功能默认关闭，通过 feature flags 管理（管理后台热切换，无需重启）：
- Token Exchange（RFC 8693）
- Pushed Authorization Requests（RFC 9126）
- DPoP（RFC 9449）
- Client Secret JWT / Private Key JWT 认证

多租户、SAML/LDAP/OIDC-RP 联邦、SCIM 等结构性功能保留代码但冻结产品投入，以默认 `'default'` 租户运行。详见 `docs/operations/feature-flags.md` 的"自用最小运行时基线"章节。

三个已确认的技术前提：
1. **数据层走 `origin/pg-support` 分支**：该分支已完成 better-sqlite3 → Drizzle ORM + PostgreSQL 的全量迁移（`server/schema.ts` + `drizzle.config.ts` + `db:push/generate/migrate` 脚本），本方案所有新表都在它之上增量。
2. **引入 RS256 + 真实 JWKS + 密钥轮换**，HS256 保留一个兼容窗口后移除。
3. 四个阶段都要可实施细节。

---

## 阶段 0：地基（1～2 周，阻塞后续一切）

### 0.1 合并 pg-support 到 main

`origin/pg-support` 领先 main 一个提交，改动 51 个文件（+3115/-2532），已把 `server/routes/*`、`server/utils/token-blacklist.ts`、`server/middleware/*`、全部测试改为 Drizzle 异步写法。

步骤：
1. `git merge origin/pg-support`，冲突预期集中在 main 上后加的文件（`ENTERPRISE-OAUTH-ANALYSIS-COMPLETE.md` 无冲突）。
2. 起本地 PG：`docker run -d -p 5432:5432 -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=idp_center postgres:16`。
3. `.env` 补 `DATABASE_URL` 或 `PG_HOST/PG_PORT/PG_USER/PG_PASSWORD/PG_DATABASE`；删除 `DB_PATH`、`JWT_REFRESH_SECRET`（pg-support 的 `server/config.ts` 已移除后者 —— 它在 main 上从未被引用过）。
4. `pnpm db:push && pnpm test`。
5. ✅ 已完成（2026-08）：`auth.db` 从未提交过、`Dockerfile` 也从未有过 `COPY auth.db`，这两项本就是 moot；`tests/better-sqlite3.d.ts` 与 `package.json`/`pnpm-workspace.yaml` 里的 `better-sqlite3` devDependency 已移除——唯一的实际用途（`tests/github-oauth.property.test.ts` 的内存态 fixture db）已改用 Node 内置的 `node:sqlite`（`DatabaseSync`），API 与 better-sqlite3 同步接口基本一致，无需再装原生编译工具链，`Dockerfile` 里对应的 `python3/make/g++/pkg-config/binutils` 安装步骤和 `better-sqlite3` 专属裁剪步骤也一并删除。
6. **把 `.env` 从工作区移除并加入 `.gitignore`** —— 当前 `.env` 带真实外观的密钥被提交了，同时轮换其中所有凭证。

> 注意：pg-support 的 `initDatabase()` 在启动时执行 `npx drizzle-kit push`。生产环境要改成显式 `pnpm db:migrate`（见 4.1），启动期 push 只保留在 dev/test。

### 0.2 拆分 `.well-known`（必须先做）

`server.ts` 把同一个 `oidcRouter` 挂在 `/api/oidc` 和 `/.well-known` 两处。后果：`/api/oidc/openid-configuration` 成了活别名；`/.well-known/*` 请求上 `req.tenantId === undefined`（`tenantContext` 只挂在 `/api`）。任何新增的租户感知 handler 挂到 `oidcRouter` 上都会在 `.well-known` 路径崩掉。

- 新建 `server/routes/well-known.ts`，只放 discovery + JWKS，租户无关。
- `oidcRouter` 只挂 `/api/oidc`。

### 0.3 补 OIDC 特征测试（必须先做）

`/api/oidc/*` 目前**零测试**，而阶段一是对全站唯一 OAuth 代码路径的重写。先按 `tests/integration/auth.test.ts` 的既有模式写 `tests/integration/oidc.test.ts`，覆盖当前 authorize → token → userinfo → refresh 的完整行为：

```ts
describe.skipIf(!process.env.DATABASE_URL && !process.env.PG_HOST)(...)
beforeAll(async () => { await initDatabase(); })
beforeEach(async () => { /* Drizzle delete 各表 */ })
```

---

## 阶段一：核心 OAuth 补齐（1～2 个月）

新增依赖：`jose@^5`。回调投递用 Node 原生 `fetch`，不引队列。

### 1.1 非对称签名 + JWKS + 密钥轮换

**新表** `server/schema.ts`：

```ts
export const signingKeys = pgTable('signing_keys', {
  id: text('id').primaryKey(),
  kid: text('kid').notNull().unique(),
  alg: text('alg').notNull().default('RS256'),
  use: text('use').notNull().default('sig'),
  publicJwk: text('public_jwk').notNull(),          // 明文 JSON
  privateJwkEnc: text('private_jwk_enc').notNull(), // encryptToken(JSON.stringify(privateJwk))
  status: text('status').notNull().default('next'), // active | next | retired
  createdAt: timestamp('created_at').defaultNow(),
  activatedAt: timestamp('activated_at'),
  retiredAt: timestamp('retired_at'),
  expiresAt: timestamp('expires_at'),
}, (t) => [index('idx_signing_keys_status').on(t.status)]);
```

密钥**全局**而非按租户：issuer 只有一个 `config.APP_URL`，per-tenant 密钥需要 per-tenant issuer 与 JWKS URI，留到 2.6 一起做。

**新建 `server/services/keys.service.ts`**：

```ts
export interface ActiveSigner { kid: string; alg: string; key: CryptoKey }
export async function ensureKeysInitialized(): Promise<void>;   // initDatabase() 种子阶段调用
export async function generateSigningKey(status?: 'active'|'next'): Promise<string>;
export async function getActiveSigner(): Promise<ActiveSigner>; // 内存缓存 60s
export async function getVerificationKey(kid: string): Promise<CryptoKey | null>;
export async function publishJwks(): Promise<{ keys: JWK[] }>;  // active + next + 未过期的 retired
export async function rotateKeys(opts?: { retireGraceMs?: number }): Promise<{ newKid: string; retiredKid: string | null }>;
export function clearKeyCache(): void;
```

- `jose.generateKeyPair('RS256', { extractable: true })` → `exportJWK`；`kid = await calculateJwkThumbprint(publicJwk)`。
- 私钥 JWK 落库前过 **现有的** `server/services/crypto.ts` 的 `encryptToken()`（AES-256-GCM，密钥源自 `ENCRYPTION_KEY`，回退 `JWT_SECRET`）—— 不要另写加密。缓存导入后的 `CryptoKey`，不缓存明文串。
- `rotateKeys()`：`next` → `active`；旧 `active` → `retired`（`expiresAt = now + max(idToken 生命期, 24h)`）；再生成新 `next`。JWKS 同时发布三种状态，保证 RP 的 JWKS 缓存永不 miss `kid`。
- 轮换周期 90 天，挂到 `server.ts` 已有的 `cleanupExpiredTokens` 定时器上；同一处清理 `retired && expiresAt < now`。
- JWKS 响应加 `Cache-Control: public, max-age=300`。

**新建 `server/oauth/jwt.ts`** —— 全站唯一的 JWT 签发/验证入口：

```ts
export async function signIdToken(claims, opts: { audience: string; expiresInSec: number }): Promise<string>;
export async function signAccessToken(claims, opts: { expiresInSec: number }): Promise<string>;
export async function signLogoutToken(claims): Promise<string>; // typ: 'logout+jwt'
export async function verifyInternalJwt(token: string): Promise<JWTPayload>;
```

`verifyInternalJwt` 是兼容桥：
1. `jose.decodeProtectedHeader(token)`；
2. `alg === 'HS256'` → 用 `config.JWT_SECRET` 验，**显式 pin** `algorithms: ['HS256']`；
3. `alg === 'RS256'` → 必须有 `kid`，走 `getVerificationKey(kid)`；未知 kid 直接拒绝，**绝不回落到 HMAC 分支**（这是 alg-confusion 漏洞）；
4. 其它（含 `none`）一律拒绝。

**HS256 → RS256 三次发布**：

| 发布 | 内容 | 风险 |
|---|---|---|
| **A** | 建表 + `ensureKeysInitialized()` + JWKS 输出真实公钥 + `server/middleware/auth.ts` 从 `jwt.verify` 换成 `await verifyInternalJwt()`（`isTokenRevoked` 与 `users.isActive` 检查原样保留）。**不改 token 格式。** | 无，双验证接受所有存量 token |
| **B** | id_token 与 access token 全切 RS256；`server/routes/auth.ts` 的登录/刷新签发**同一提交内**一起切；discovery 改 `id_token_signing_alg_values_supported: ['RS256']` | 存量 HS256 token 仍走分支 2 |
| **C** | 删除 HS256 分支 | 必须晚于 B 至少一个发布，且间隔 > `TOKEN_CONFIG.accessTokenExpiry`(15m) |

长会话不受影响：refresh token 是 `crypto.randomBytes(32)` 的不透明串，不是 JWT，7/30 天的会话寿命与签名算法无关；兼容窗口只需覆盖 15 分钟的 access token TTL。

**排期约束**：A 必须早于 B（JWKS 要先能被 RP 拉到）；`server/routes/auth.ts` 必须与 B 同提交，否则 C 之后所有新登录都验不过。

### 1.2 /token 重构为 grant 注册表

```
server/oauth/
  types.ts          GrantContext / GrantHandler / AuthenticatedClient / TokenResponse
  errors.ts         OAuthError + sendOAuthError（RFC 6749 §5.2 原始形状）
  jwt.ts            见 1.1
  client-auth.ts    authenticateClient()
  registry.ts       grantRegistry: Record<string, GrantHandler>
  issue.ts          issueAccessToken / issueRefreshToken / issueIdToken —— 唯一的签发+落库点
  token-lookup.ts   resolveToken()
  introspect.ts  revoke.ts
  grants/
    authorization-code.ts  refresh-token.ts  client-credentials.ts
    device-code.ts         token-exchange.ts
```

`server/routes/oidc.ts` 只留路由接线，`/token` 缩到约 25 行。

**核心类型** `server/oauth/types.ts`：

```ts
export type ClientAuthMethod =
  | 'client_secret_post' | 'client_secret_basic'
  | 'client_secret_jwt'  | 'private_key_jwt' | 'none';

export interface AuthenticatedClient {
  row: typeof clients.$inferSelect;
  clientId: string; tenantId: string;
  authMethod: ClientAuthMethod;
  grantTypes: string[];      // 解析 clients.grant_types
  allowedScopes: string[];   // 解析新增的 clients.allowed_scopes
}

export interface GrantContext {
  req: Request; res: Response;
  params: Record<string, string>;
  client: AuthenticatedClient;
  tenantId: string; grantType: string; now: Date;
}

export interface GrantHandler {
  grantType: string;
  requiresClientAuth: boolean;             // 仅 public + PKCE 客户端为 false
  allowedAuthMethods?: ClientAuthMethod[];
  handle(ctx: GrantContext): Promise<TokenResponse>;
}
```

**`/token` 调度顺序**：

```
1. grant_type 缺失                        -> invalid_request (400)
2. handler = grantRegistry[grant_type]，无 -> unsupported_grant_type (400)
3. client = await authenticateClient(req) -> 抛 invalid_client (401 + WWW-Authenticate: Basic)
4. !client.grantTypes.includes(grant_type)-> unauthorized_client (400)   ← grant_types 唯一强制点
5. allowedAuthMethods 不匹配              -> invalid_client (401)
6. res.json(await handler.handle(ctx))
   catch OAuthError -> sendOAuthError()   // 原始 RFC JSON，不走 response.ts 信封
```

`clients.grant_types` 同时在 `/authorize`（`response_type=code` ⇒ 需含 `authorization_code`）和 `/device_authorization`（需含 device URN）强制。`client-auth.ts` 提供 `parseList(raw)` 处理现存的「逗号串或 JSON 数组」双格式，并复用到 `redirect_uris` —— 该解析逻辑目前在 `oidc.ts` 里重复了三遍。

**客户端认证** `server/oauth/client-auth.ts`：

```ts
export async function authenticateClient(req: Request): Promise<AuthenticatedClient>;
export async function verifyClientSecret(row: ClientRow, presented: string): Promise<boolean>;
```

- **先按 `(client_id, tenant_id)` 查行，再比对 secret。** 现在 `client_secret` 写在 `WHERE` 里，导致无法定时安全比较、无法哈希存储、且把「客户端不存在」和「密钥错误」混为一谈。
- 同时出现两种认证方式 ⇒ `invalid_request`（RFC 6749 §2.3）。
- `client_secret_basic`：拆 `Authorization: Basic`，**两半都要 form-urldecode**（§2.3.1）—— 这正是「已在 discovery 里宣称但没实现」的那一项不能简单字符串比较的原因。
- 比较用 `crypto.timingSafeEqual`。
- 密钥哈希迁移：`clients` 加 `client_secret_hash`、`client_secret_alg`。`verifyClientSecret` 优先用 hash，否则明文比对**并顺手惰性写入 bcrypt hash**；后续版本再删 `client_secret` 列。
- `client_secret_jwt`（HS256，密钥=client secret）/ `private_key_jwt`（RS256/ES256，密钥取自客户端 JWKS）：`client_assertion_type=urn:ietf:params:oauth:client-assertion-type:jwt-bearer`。校验 `iss === sub === client_id`、`aud ∈ {issuer, token_endpoint}`、`exp` 存在且 ≤ 5 分钟、`jti` 未用过。客户端 JWKS 用 `jose.createLocalJWKSet` / `createRemoteJWKSet`。
- `clients` 加 `token_endpoint_auth_method text default 'client_secret_post'`，拒绝注册方式以外的认证方式（防降级）。

**新增表/列**：

```ts
export const clientAssertionJtis = pgTable('client_assertion_jtis', {
  jti: text('jti').primaryKey(),
  clientId: text('client_id').notNull(),
  expiresAt: timestamp('expires_at').notNull(),
});
// clients += jwks, jwks_uri, token_endpoint_auth_method,
//            allowed_scopes, allowed_audiences, is_resource_server boolean default false
```

jti 重放保护 = 插入即唯一约束冲突 ⇒ `invalid_client`；`server/utils/cleanup.ts` 清过期行。

**client_credentials 与 `access_tokens.user_id NOT NULL` + 失败关闭的冲突**

`isTokenRevoked()` 在查不到行时返回 `true`（fail-closed），所以机器令牌**必须**有 `access_tokens` 行，但它没有用户。

采用方案：保留 `user_id NOT NULL`，机器令牌写 `user_id = client_id`，加判别列。已确认 `access_tokens.user_id` 在 schema 中**没有外键**，这样写合法。`token-blacklist.ts` 因此**零改动**。

```ts
// access_tokens +=
subjectType:   text('subject_type').notNull().default('user'),  // 'user' | 'client'
tenantId:      text('tenant_id').notNull().default('default'),
tokenHash:     text('token_hash'),                              // sha256(token)，加索引
oidcSessionId: text('oidc_session_id'),
authCodeId:    text('auth_code_id'),
```

配套：`server/middleware/auth.ts` 在 `verifyInternalJwt` 之后加 `if (payload.sub_type === 'client') → 401`，机器令牌不得访问用户态路由；另出 `authenticateClientToken` 供 M2M 路由使用。

`token_hash` 用于 introspect/revoke/userinfo 的查找（RS256 JWT 约 1KB，而 `token` 列带唯一索引）。**必须在切换到 hash 查找的同一次迁移里回填存量行**，否则 introspect 查不到任何已签发令牌。

`clientCredentialsGrant`：不发 refresh token、不发 id_token，`scope = 请求 ∩ client.allowedScopes`，claims `{ sub: client_id, client_id, sub_type: 'client', tenantId, scope }`。

**重构时顺带修掉的既有缺陷**（每条配一个测试）：

| 缺陷 | 修法 |
|---|---|
| 刷新后 scope 丢失（硬编码 `'openid'`） | `refresh_tokens` 加 `scope text default 'openid'`，透传 |
| refresh 未按租户隔离 | `refresh_tokens` 加 `tenant_id` 并入查询条件 |
| refresh 重放无检测 | 加 `family_id`；用已撤销的 token 换取 ⇒ 撤销整个 family + `invalid_grant` |
| `auth_codes` 无 `tenant_id` | 加 `tenant_id text not null default 'default'`，进查询条件 |
| `code_challenge_method` 存了不读，S256 硬编码 | 支持 `S256`/`plain`，非法值在 `/authorize` 阶段就拒绝 |
| 授权码核销存在先读后写的竞态 | 改 `UPDATE auth_codes SET used=true WHERE id=? AND used=false RETURNING *`（Drizzle `.returning()`）；重放已用码时通过 `access_tokens.auth_code_id` 撤销由它签发的一切 |

**token-exchange (RFC 8693) v1 范围**：只接受 `subject_token_type = urn:ietf:params:oauth:token-type:access_token`；subject token 走 `resolveToken()`（与 introspect 同一路径）；要求 client 的 `grant_types` 含该 URN 且目标在 `clients.allowed_audiences` 内；签发降权的 access token，带 `act` claim（当传了 `actor_token`）；返回 `issued_token_type`；**拒绝跨租户交换**。

### 1.3 introspect (RFC 7662) + revoke (RFC 7009)

`server/oauth/token-lookup.ts`：

```ts
export type ResolvedToken =
  | { kind: 'access';  row: AccessTokenRow;  claims?: JWTPayload }
  | { kind: 'refresh'; row: RefreshTokenRow }
  | null;
export async function resolveToken(raw: string, tenantId: string,
  hint?: 'access_token'|'refresh_token'): Promise<ResolvedToken>;
```

先试 hint 指定的类型，再试另一种。access 查找用 `sha256(raw)` 命中 `access_tokens.token_hash` **且** `tenant_id`。签名验证只作参考，**DB 行才是权威** —— 伪造的 JWT 因为没有对应行，自然 inactive。

`POST /api/oidc/introspect`（需客户端认证）：
- 客户端认证失败 ⇒ `401 {error:'invalid_client'}`，这是 introspect 唯一允许返回的错误；
- 缺 `token` ⇒ `400 invalid_request`；
- 查不到 / 过期 / 已撤销 / `row.clientId !== client.clientId` ⇒ `200 {active:false}`；
- 否则返回 `{active:true, scope, client_id, username, token_type:'Bearer', exp, iat, nbf, sub, aud, iss, jti, sub_type, tenant_id}`；
- **跨客户端内省是真实的信息泄露**：默认只能内省自己的令牌；只有 `clients.is_resource_server = true` 的客户端可内省本租户内任意令牌。

`POST /api/oidc/revoke`（需客户端认证）：
- 一律 `200` 空体，包括未知 token；只有 hint 指向不支持的类型时返回 `unsupported_token_type`；
- access token ⇒ 复用 `token-blacklist.ts` 的 `revokeToken()`，签名向后兼容地扩展为 `revokeToken(token, reason, opts?: { clientId?, tenantId? })`；
- refresh token ⇒ 置 `revoked`，**并级联**撤销同 `oidc_session_id` 的 access token（RFC 7009 §2.1 SHOULD）；
- token 属于别的客户端 ⇒ 仍返回 `200` 但不做任何事（不泄露存在性）。

`token-blacklist.ts` 新增：`revokeTokensBySession(oidcSessionId, reason)`、`revokeTokensByUserAndClient(userId, clientId, reason)`（1.5 会用）。

discovery 增加 `introspection_endpoint`、`revocation_endpoint` 及两个 `*_endpoint_auth_methods_supported`。

### 1.4 设备授权码流 (RFC 8628)

```ts
export const deviceCodes = pgTable('device_codes', {
  id: text('id').primaryKey(),
  deviceCode: text('device_code').notNull().unique(),
  userCode: text('user_code').notNull(),               // 8 位取自 'BCDFGHJKLMNPQRSTVWXZ'，显示为 BCDF-GHJK
  clientId: text('client_id').notNull(),
  tenantId: text('tenant_id').notNull().default('default'),
  scope: text('scope').default('openid'),
  status: text('status').notNull().default('pending'), // pending|approved|denied|redeemed|expired
  userId: text('user_id'), nonce: text('nonce'),
  interval: integer('interval').notNull().default(5),
  lastPolledAt: timestamp('last_polled_at'),
  pollCount: integer('poll_count').notNull().default(0),
  expiresAt: timestamp('expires_at').notNull(),
  approvedAt: timestamp('approved_at'),
  createdAt: timestamp('created_at').defaultNow(),
}, (t) => [
  uniqueIndex('idx_device_codes_usercode_tenant').on(t.userCode, t.tenantId),
  index('idx_device_codes_expires').on(t.expiresAt),
]);
```

`POST /api/oidc/device_authorization`（需客户端认证，注册为 `none` 的公开客户端放行）返回 `{device_code, user_code, verification_uri, verification_uri_complete, expires_in: 600, interval: 5}`。

**路由说明**：前端已切换为 `createBrowserHistory()` 的 SPA，服务端生产环境通过 `app.get('*')` 回退到 `index.html`，开发环境由 Vite middleware 处理。因此 `verification_uri = ${APP_URL}/device`，`verification_uri_complete = ${APP_URL}/device?user_code=BCDF-GHJK`，由 SPA 自行解析 —— 与 `src/App.tsx` 处理 `github_code` 的现有做法一致。

前端新增 `src/routes/device.tsx` + `src/pages/DeviceVerify.tsx`，鉴权门禁照抄 `src/routes/authorize.tsx` 的 `beforeLoad`（未登录跳 `/login` 并带 `redirect`）。流程：输入/确认码 → `GET /api/oidc/device/verify?user_code=`（需登录，返回 client_name + scopes）→ `POST /api/oidc/device/approve` | `/device/deny`。

轮询语义（全部 HTTP 400 + OAuth 错误体），实现在 `grants/device-code.ts`：

| 条件 | 返回 |
|---|---|
| 未知码，或属于其它客户端 | `invalid_grant` |
| `expiresAt < now` | `expired_token` |
| `status = pending` | `authorization_pending` |
| 距 `lastPolledAt` 不足 `interval` | `slow_down`，**同时持久化 `interval += 5`** |
| `status = denied` | `access_denied` |
| `status = approved` | 按 authorization_code 的方式签发（scope 含 `openid` 时带 id_token），随后 `UPDATE ... WHERE status='approved' RETURNING` 置为 `redeemed` |
| `status = redeemed` | `invalid_grant` |

`cleanup.ts` 清过期码。`/device_authorization` 加限流，且单会话内 `user_code` 输错 5 次即锁 —— 用户码熵值本就很低。

### 1.5 会话与登出（RP-initiated / front-channel / back-channel）

```ts
export const oidcSessions = pgTable('oidc_sessions', {
  id: text('id').primaryKey(),
  sid: text('sid').notNull(),                             // 每客户端会话 id → id_token 的 sid claim
  browserSessionId: text('browser_session_id').notNull(), // → sessions.id，即 SSO 会话
  userId: text('user_id').notNull().references(() => users.id),
  clientId: text('client_id').notNull(),
  tenantId: text('tenant_id').notNull().default('default'),
  scope: text('scope'),
  authTime: timestamp('auth_time').notNull().defaultNow(),
  lastRefreshedAt: timestamp('last_refreshed_at').defaultNow(),
  terminatedAt: timestamp('terminated_at'),
  createdAt: timestamp('created_at').defaultNow(),
}, (t) => [
  uniqueIndex('idx_oidc_sessions_sid_tenant').on(t.sid, t.tenantId),
  index('idx_oidc_sessions_browser').on(t.browserSessionId),
  index('idx_oidc_sessions_user_client').on(t.userId, t.clientId),
]);

export const backchannelLogoutDeliveries = pgTable('backchannel_logout_deliveries', {
  id: text('id').primaryKey(),
  oidcSessionId: text('oidc_session_id').notNull(),
  clientId: text('client_id').notNull(),
  url: text('url').notNull(),
  attempts: integer('attempts').notNull().default(0),
  nextAttemptAt: timestamp('next_attempt_at').notNull().defaultNow(),
  status: text('status').notNull().default('pending'),   // pending|delivered|failed
  lastError: text('last_error'),
  createdAt: timestamp('created_at').defaultNow(),
});
// clients += frontchannel_logout_uri, backchannel_logout_uri,
//            frontchannel_logout_session_required, backchannel_logout_session_required,
//            post_logout_redirect_uris
// access_tokens / refresh_tokens += oidc_session_id
```

会话串联：`POST /authorize` 为 `(browserSessionId, clientId)` 创建或复用 `oidc_sessions` 行，`sid` 暂存到授权码上，最终作为 `sid` + `auth_time` 出现在 id_token 里，刷新时原样带回。**排期约束**：`browserSessionId` 取自现有 `sessions` 表，但该表目前只写不与令牌关联 —— `server/routes/auth.ts` 必须先在登录令牌里嵌入 `bsid` claim，`sid` 才有意义。

`GET|POST /api/oidc/end_session`：
1. 用 `verifyInternalJwt` 验 `id_token_hint` 签名，**忽略 `exp`**（登出提示本就应该是过期的），取 `sub`/`sid`/`aud`；
2. `post_logout_redirect_uri` 与 `clients.post_logout_redirect_uris` **精确匹配**，且仅在 `id_token_hint` 验证通过时生效，否则停留在中间页；
3. 按规范 SHOULD 做二次确认，跳 `${APP_URL}/logout?...`；
4. `POST /api/oidc/end_session/confirm`：整个 `browserSessionId` 置 `terminatedAt` → `revokeTokensBySession()` → 按 `oidc_session_id` 撤销 refresh token → 删 `sessions` 行 → 入队 back-channel → 返回 `{ front_channel_logout_uris: string[], post_logout_redirect_uri }`；
5. front-channel：由 SPA 为每个 URI 渲染隐藏 `<iframe src="{uri}?iss={issuer}&sid={sid}">`，等 `onload`（上限 2s）后跳 `post_logout_redirect_uri` + `state`。**当前架构由 SPA 管理 iframe** —— 服务端只返回 URI 列表，iframe 归 SPA 管。新增 `src/routes/logout.tsx` + `src/pages/Logout.tsx`。（注：已从 hash 路由切换至 history 路由，服务端现在可以渲染 HTML 页，但保持 SPA 管理 iframe 的架构不变。）

`server/services/backchannel-logout.service.ts`：

```ts
export async function enqueueBackchannelLogout(session: OidcSessionRow): Promise<void>;
export async function drainBackchannelQueue(): Promise<number>;  // 挂 cleanup 定时器
async function buildLogoutToken(client: ClientRow, session: OidcSessionRow): Promise<string>;
```

logout token：RS256 经 `signLogoutToken`，头 `{alg:'RS256', kid, typ:'logout+jwt'}`，claims `{iss, aud: client_id, iat, exp: iat+120, jti, sub, sid, events: {'http://schemas.openid.net/event/backchannel-logout': {}}}` —— **不得包含 `nonce`**。以 `application/x-www-form-urlencoded` 的 `logout_token=…` POST 投递，5s 超时，3 次指数退避。仓库内无任务队列，因此从 `server.ts` 已有的 `cleanupExpiredTokens` 定时器里 drain；**登出响应绝不等待 RP 可用性**。

### 1.6 P1：动态客户端注册、PAR、DPoP

- **动态客户端注册 (RFC 7591/7592)**：`POST /api/oidc/register`，`registration_access_token` + `registration_client_uri`；新表列 `clients.registration_token_hash`。默认关闭，由 `tenants.settings` 里的开关按租户启用，否则是开放注册漏洞。
- **PAR (RFC 9126)**：新表 `pushed_auth_requests(request_uri pk, client_id, tenant_id, payload jsonb, expires_at)`，`POST /api/oidc/par` 需客户端认证，`/authorize` 接受 `request_uri=urn:ietf:params:oauth:request_uri:*`。discovery 加 `pushed_authorization_request_endpoint`、`require_pushed_authorization_requests`。
- **DPoP (RFC 9449)**：`server/oauth/dpop.ts` 校验 `DPoP` 头（`typ: dpop+jwt`、`htm`/`htu`/`iat`/`jti`、jti 重放表），令牌加 `cnf: { jkt }`，`token_type: 'DPoP'`；`middleware/auth.ts` 对带 `cnf` 的令牌强制校验绑定。新表 `dpop_jtis`。放在 1.2 完成之后，因为要复用 `client-assertion` 的 jti 重放机制。

### 阶段一验证

```bash
pnpm test                                    # 含新增 tests/integration/oidc.test.ts
```

- 一致性：跑 [OpenID Foundation Conformance Suite](https://www.certification.openid.net/) 的 `oidcc-basic-certification-test-plan`。
- 手工：`curl -u client:secret -d 'grant_type=client_credentials' $APP/api/oidc/token`；`.../introspect`；设备流用 `--data-urlencode` 走完 device_authorization → 浏览器 `#/device` → 轮询。
- 用 `jose` 从 `/.well-known/jwks.json` 拉公钥独立验签 id_token，确认第三方 RP 可用。

---

## 阶段二：企业级功能（2～3 个月）

### 2.1 MFA 增强

新依赖：`@simplewebauthn/server` + `@simplewebauthn/browser`。

```ts
export const mfaFactors = pgTable('mfa_factors', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => users.id),
  type: text('type').notNull(),          // totp | sms | email | webauthn | recovery
  name: text('name'),
  secretEnc: text('secret_enc'),         // TOTP 密钥，走 crypto.ts 的 encryptToken
  phone: text('phone'), email: text('email'),
  credentialId: text('credential_id'), publicKey: text('public_key'),
  counter: integer('counter').default(0), transports: text('transports'),
  status: text('status').notNull().default('pending'),  // pending | active | disabled
  lastUsedAt: timestamp('last_used_at'), createdAt: timestamp('created_at').defaultNow(),
}, (t) => [index('idx_mfa_factors_user').on(t.userId, t.type)]);

export const mfaChallenges = pgTable('mfa_challenges', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull(), factorId: text('factor_id'),
  type: text('type').notNull(), codeHash: text('code_hash'), challenge: text('challenge'),
  attempts: integer('attempts').notNull().default(0),
  expiresAt: timestamp('expires_at').notNull(), consumedAt: timestamp('consumed_at'),
});

export const tenantMfaPolicies = pgTable('tenant_mfa_policies', {
  tenantId: text('tenant_id').primaryKey().references(() => tenants.id),
  required: boolean('required').default(false),
  requiredForAdmins: boolean('required_for_admins').default(true),
  allowedTypes: text('allowed_types').default('totp,webauthn,email'),
  rememberDeviceDays: integer('remember_device_days').default(30),
});
```

- **迁移**：`users.otp_secret/otp_enabled` 的存量数据回填成 `type='totp'` 的 `mfa_factors` 行，并**顺带加密**（现在是明文存的）；两列保留一个发布周期后删除。
- **Email OTP**：复用 `server/services/email.service.ts` 与 `email-templates.ts`，新增 `otpCodeEmail` 模板。6 位数字，5 分钟，`codeHash` 存 sha256，最多 5 次尝试。
- **SMS OTP**：新建 `server/services/sms.service.ts`，定义 `SmsProvider` 接口（`send(phone, template, vars)`），先实现阿里云/腾讯云二选一 + 一个 `ConsoleSmsProvider` 供 dev/test。配置走 `server/config.ts` 的 zod schema，全部 optional。
- **WebAuthn/FIDO2**：`server/routes/mfa.ts` 提供 `/webauthn/register/options|verify` 与 `/webauthn/auth/options|verify`。`rpID` 取 `new URL(config.APP_URL).hostname`，`origin` 取 `config.APP_URL`。前端 `src/pages/SecuritySettings.tsx` 用 `@simplewebauthn/browser`。
- **恢复码**：一次性生成 10 个，bcrypt 存 `mfa_factors(type='recovery')`，用后即焚。**这是当前完全缺失的一环**：现在 TOTP 一旦丢失就无法自助恢复。
- **补上缺失的关闭入口**：`DELETE /api/user/mfa/factors/:id`（需二次认证）。目前只有 setup/verify，没有 disable。
- **推送认证**暂不做 —— 需要移动端 App，不在本仓库范围。
- **统一登录流**：`server/routes/auth.ts` 现有的 `403 AUTH_OTP_REQUIRED` 改为返回 `{ mfa_token, factors: [{id, type, name}] }`，前端选因子 → `POST /api/auth/mfa/challenge` → `POST /api/auth/mfa/verify`。`mfa_token` 是 5 分钟的短期 JWT，**不得**是可用的 access token。
- **step-up**：id_token / access token 加 `acr` 与 `amr` claims（`amr: ['pwd','otp']` 等）；`/authorize` 支持 `acr_values` 与 `prompt=login`、`max_age`；不满足则强制重新认证。这条同时是阶段三自适应认证的接入点。

### 2.2 联合身份（SAML 2.0 SP / OIDC RP / LDAP）

> 社交登录扩展按要求排除。本节做的是**通用框架**，现有 GitHub 登录迁移进来作为第一个实现。

新依赖：`@node-saml/node-saml`、`openid-client`、`ldapts`。

```ts
export const identityProviders = pgTable('identity_providers', {
  id: text('id').primaryKey(),
  tenantId: text('tenant_id').notNull().references(() => tenants.id),
  alias: text('alias').notNull(),                  // URL 片段：/api/federation/:alias/...
  type: text('type').notNull(),                    // saml | oidc | ldap | oauth2
  displayName: text('display_name').notNull(),
  enabled: boolean('enabled').default(true),
  configEnc: text('config_enc').notNull(),         // 整份配置 JSON 走 encryptToken
  attributeMapping: text('attribute_mapping').notNull().default('{}'),
  jitProvisioning: boolean('jit_provisioning').default(true),
  linkByVerifiedEmail: boolean('link_by_verified_email').default(false),
  defaultRoles: text('default_roles'),
  createdAt: timestamp('created_at').defaultNow(),
}, (t) => [uniqueIndex('idx_idp_tenant_alias').on(t.tenantId, t.alias)]);
```

- **抽象出 `server/services/identity-link.service.ts`**：把 `server/routes/github.ts:72-116` 的 `findOrCreateUserFromGitHub()` 泛化为 `findOrLinkUser(tenantId, provider, profile, opts)`，沿用「按 provider_user_id 找 → 按已验证邮箱找 → 建号并加后缀避重名」三段式。**现有实现完全忽略 `tenant_id`**（建号时走列默认值），泛化时必须修掉。`linked_accounts` 表本身已经是 provider 泛化的，直接复用。
- **SAML SP**：`server/routes/federation/saml.ts`，`GET /api/federation/:alias/saml/login`（生成 AuthnRequest，可选签名）、`POST /api/federation/:alias/saml/acs`（校验签名、`InResponseTo`、`NotOnOrAfter`、Audience，防重放：`saml_assertion_ids` 表）、`GET /api/federation/:alias/saml/metadata`。SP 签名/加密密钥复用 1.1 的 `signing_keys`（`use='saml'`）。SLO 走 1.5 的 back-channel 队列。
- **OIDC RP**：`server/routes/federation/oidc-rp.ts`，用 `openid-client` 的 discovery + code+PKCE。state/nonce 存现有的 `oauth_states` 表（加 `provider`、`nonce`、`redirect_after` 列）。
- **LDAP/AD**：`server/services/ldap.service.ts`，`ldapts` 做 bind 认证（先 service account 搜 DN，再用用户凭证 bind）。登录时按租户的 IdP 配置尝试 LDAP，成功则 JIT 建号。连接池 + 5s 超时 + LDAPS 强制。组同步映射到 2.3 的角色。
- **登录页发现**：`GET /api/auth/idps?tenant_id=` 返回可用 IdP 列表供 `src/pages/Login.tsx` 渲染；支持按邮箱域名自动路由（`identity_providers` 加 `email_domains`）。
- **管理 UI**：`src/pages/admin/IdentityProviders.tsx`，沿用 `src/components/admin/{AdminTable,AdminDialog,AdminPageHeader}.tsx`。

### 2.3 管理 API 增强（RBAC + SCIM）

```ts
export const roles = pgTable('roles', { id, tenantId, name, description, isSystem });
export const permissions = pgTable('permissions', { id, code, description });   // 全局字典
export const rolePermissions = pgTable('role_permissions', { roleId, permissionId });
export const groups = pgTable('groups', { id, tenantId, name, parentId });
export const userRoles = pgTable('user_roles', { userId, roleId, tenantId });
export const userGroups = pgTable('user_groups', { userId, groupId });
export const groupRoles = pgTable('group_roles', { groupId, roleId });
```

- `users.is_admin` 保留为兼容字段，迁移为 `tenant-admin` 角色；`server/middleware/auth.ts` 的 `authenticateAdmin` 改为 `requirePermission('admin:*')`，`is_admin` 与角色取并集，一个发布周期后废弃 `is_admin`。
- **修掉现有的租户越权**：`server/routes/admin.ts` 的 `GET /tenants` 与用户相关端点**没有按 `req.tenantId` 过滤**，任何管理员能看到所有租户和用户（client 相关端点是过滤了的）。引入 `platform-admin` vs `tenant-admin` 两级，后者严格限本租户。
- **`tenantContext` 未校验 `tenants.is_active`** —— 一并修。
- **SCIM 2.0**：`server/routes/scim.ts`，`/scim/v2/Users`、`/scim/v2/Groups`，支持 `filter`/`startIndex`/`count`、PATCH ops、`ServiceProviderConfig`。用 1.2 的 client_credentials 令牌 + `scim:write` scope 认证。
- 角色/组 claims 按 scope 注入 id_token 与 userinfo（`roles`、`groups`）。

### 2.4 审计与合规

- `audit_logs` 加索引（当前**一个索引都没有**）：`(tenant_id, created_at desc)`、`(user_id, created_at desc)`、`(action)`。
- **统一动作命名**：现在 SCREAMING_SNAKE 与 `admin_snake_case` 混用。抽 `server/utils/audit-actions.ts` 常量枚举，全量替换。
- **修掉租户丢失**：大量 `logAudit()` 调用没传 `tenantId`，静默落到 `'default'`。改为从 `req.tenantId` 自动取，签名调整为 `logAudit({ req, action, userId?, details?, targetId? })`。
- **防篡改**：加 `prev_hash`/`hash` 列做哈希链，`GET /api/admin/audit/verify` 校验完整性。
- **导出**：`GET /api/admin/audit/export?format=csv|jsonl`，流式 `res.write`，不要一次性 load。
- **保留策略**：`tenants.settings` 里配保留天数，`cleanup.ts` 按期归档/删除。
- **合规报表**：`GET /api/admin/compliance/report?standard=soc2|gdpr`，聚合登录成功率、MFA 覆盖率、特权操作、异常事件。GDPR：数据导出 `GET /api/user/data-export` 与已有的 `account_deletion_requests` 打通。

### 2.5 监控与可观测性

新依赖：`prom-client`、`@opentelemetry/sdk-node` + `@opentelemetry/auto-instrumentations-node`。

- `GET /metrics`（内网/bearer 保护）：登录成功失败数、令牌签发数按 grant_type、MFA 挑战、introspect QPS、PG 连接池、back-channel 投递失败数。
- `server/utils/logger.ts` 已有 JSON 结构化输出，加 `trace_id`/`span_id`/`tenant_id`/`request_id` 字段；`server.ts` 加 request-id 中间件。
- `GET /api/health` 升级为 `/livez` + `/readyz`（readyz 探 PG 与 SMTP）。
- 告警基线：登录失败率突增、密钥轮换失败、back-channel 积压、JWKS 请求异常。

### 2.6 按租户 issuer（可选，触发条件：客户要求密钥隔离）

`/{tenant}/.well-known/openid-configuration`，`signing_keys` 加 `tenant_id`，`getActiveSigner(tenantId)`。改动面大，除非有明确合规诉求否则不做。

### 阶段二验证

- WebAuthn 用 Chrome DevTools 的 Virtual Authenticator 面板端到端跑注册+登录。
- SAML 用 `docker run -p 8080:8080 kristophjunge/test-saml-idp` 或 SimpleSAMLphp 做对接测试。
- LDAP 用 `docker run -p 389:389 osixia/openldap`。
- SCIM 用 Okta/Azure AD 的 SCIM 合规性测试工具。
- RBAC 越权：写 `tests/integration/rbac.test.ts`，断言 A 租户管理员读不到 B 租户的用户/客户端/审计。

---

## 阶段三：AI Native（3～4 个月）

前提：阶段一、二把 `audit_logs`、`oidc_sessions`、`mfa_factors`、`acr/amr` 落地后，才有可用的特征数据。**不要提前做**。

### 3.1 风险引擎（先规则，后模型）

```ts
export const loginEvents = pgTable('login_events', {          // 特征存储
  id: text('id').primaryKey(),
  userId: text('user_id'), tenantId: text('tenant_id').notNull(),
  clientId: text('client_id'), outcome: text('outcome').notNull(),  // success|fail|blocked|challenged
  ip: text('ip'), asn: text('asn'), country: text('country'), city: text('city'),
  uaFamily: text('ua_family'), osFamily: text('os_family'), deviceFingerprint: text('device_fingerprint'),
  isNewDevice: boolean('is_new_device'), isNewCountry: boolean('is_new_country'),
  impossibleTravelKmh: integer('impossible_travel_kmh'),
  hourOfDay: integer('hour_of_day'), dayOfWeek: integer('day_of_week'),
  authMethods: text('auth_methods'),                          // amr
  riskScore: integer('risk_score'), riskReasons: text('risk_reasons'),
  createdAt: timestamp('created_at').defaultNow(),
}, (t) => [index('idx_login_events_user_time').on(t.userId, t.createdAt)]);

export const userBehaviorBaselines = pgTable('user_behavior_baselines', {
  userId: text('user_id').primaryKey(),
  tenantId: text('tenant_id').notNull(),
  usualCountries: text('usual_countries'), usualAsns: text('usual_asns'),
  usualHours: text('usual_hours'), usualDevices: text('usual_devices'),
  loginCount: integer('login_count').default(0),
  peerGroup: text('peer_group'),
  featureVector: text('feature_vector'),                      // JSON，供模型使用
  updatedAt: timestamp('updated_at').defaultNow(),
});

export const riskPolicies = pgTable('risk_policies', {
  id, tenantId, name, enabled,
  minScore: integer('min_score'), maxScore: integer('max_score'),
  action: text('action'),        // allow | mfa_required | step_up | deny | notify
  createdAt,
});
```

**`server/services/risk.service.ts`**：

```ts
export interface RiskSignal { code: string; weight: number; detail?: string }
export interface RiskAssessment { score: number; signals: RiskSignal[]; action: 'allow'|'mfa_required'|'step_up'|'deny' }
export async function assessLoginRisk(ctx: {
  userId?: string; tenantId: string; ip: string; userAgent: string;
  deviceFingerprint: string; clientId?: string;
}): Promise<RiskAssessment>;
export async function recordLoginEvent(...): Promise<void>;
export async function updateBaseline(userId: string): Promise<void>;
```

**v1 纯规则**（两周内可上线，不需要任何 ML）：新国家 +30、新设备 +20、不可能旅行(>900km/h) +50、新 ASN +15、非常用时段 +10、近 1h 失败 ≥3 次 +25、IP 命中威胁情报 +40。分数 → `risk_policies` 映射动作。IP 地理用 MaxMind GeoLite2（`@maxmind/geoip2-node`，本地 mmdb，不出网）。

**v2 无监督模型**：`login_events` 攒够 4～8 周后，离线 Isolation Forest / One-Class SVM 训练每租户模型（Python 侧脚本 `ml/train_anomaly.py`，产物导出为 ONNX），Node 侧用 `onnxruntime-node` 推理。**不要在 Node 里训练**。模型分与规则分加权融合，规则分保底 —— 模型退化时系统仍可用。

**接入点**：`server/routes/auth.ts` 的登录处理，在密码校验通过之后、发令牌之前调 `assessLoginRisk()`；`mfa_required` 则复用 2.1 的 MFA 挑战流程；`step_up` 走 2.1 的 `acr_values`。这是自适应认证的全部落点，**不需要新的认证流程**。

### 3.2 UEBA

- `server/jobs/ueba.job.ts`：每日批任务重算 `user_behavior_baselines`；同组分析用简单的 k-means 或按（部门/角色/组）直接分桶 —— 先按 2.3 的 `groups` 分桶，不要一上来就聚类。
- 会话内风险：`oidc_sessions` 加 `riskScore`，令牌刷新时重新评估，风险跃升则撤销会话（复用 1.5 的 `revokeTokensBySession`）。
- 管理端 `src/pages/admin/RiskDashboard.tsx`：风险事件时间线、高风险用户榜、信号分布。

### 3.3 LLM 辅助（Claude API）

新依赖：`@anthropic-ai/sdk`。配置 `ANTHROPIC_API_KEY`（zod optional，未配置则相关功能整体禁用）。

- **审计摘要与调查助手**：`server/services/ai-assist.service.ts`，把一段时间窗内的 `audit_logs` + `login_events` 摘要成自然语言报告并给出建议。用 `claude-sonnet-5` 走批量，复杂根因分析用 `claude-opus-5`。
- **自然语言策略**：管理员输入「禁止非中国 IP 在非工作时间访问财务系统」→ LLM 输出结构化 `risk_policies` 草案 → **必须人工确认后才生效**，绝不自动应用。
- **合规检查**：把租户配置（密码策略、MFA 策略、IP 白名单、客户端配置）喂给模型，对照 SOC2/等保要求输出差距清单。
- **红线**：任何 LLM 输出都不得直接成为鉴权决策。LLM 只产出建议与草案，执行路径永远是确定性代码。用户 PII 送模型前必须脱敏（`server/utils/redact.ts`）。

### 3.4 智能测试生成

不建议做成产品功能。落成 CI 侧的开发工具：`scripts/gen-security-tests.ts`，读 `server/oauth/**` 的路由定义生成模糊测试用例喂给现有的 `fast-check`（仓库已在用）。收益远小于把 3.1 做扎实。

### 阶段三验证

- 规则引擎：`tests/risk.test.ts` 用 `fast-check` 对不可能旅行、新设备等信号做属性测试。
- 影子模式：上线前先只记录 `riskScore` 不执行动作，跑两周对比误报率，再开启 `mfa_required`。**这一步不能省。**
- 模型：离线用留出集算 precision/recall，目标误报率 < 2%（否则用户会被 MFA 挑战淹没）。

---

## 阶段四：云原生与扩展性（4～6 个月）

### 4.1 数据库（PostgreSQL 已在阶段 0 完成，补规范化）

- **停止在生产启动时跑 `drizzle-kit push`**。改为 `pnpm db:generate` 生成 `drizzle/` 下的 SQL 迁移文件并入库，部署流水线跑 `pnpm db:migrate`；`initDatabase()` 只在 `NODE_ENV !== 'production'` 时 push。pg-support 的 schema 已经预留了 `schema_migrations` 表。
- 连接池：`postgres()` 传 `max`、`idle_timeout`、`connect_timeout`（当前只设了 `connect_timeout: 10`）。
- 读写分离（可选）：`server/database.ts` 导出 `dbRo`，introspect / userinfo / 审计查询走只读副本。
- CockroachDB / 多区域：**不建议**。除非有跨洲低延迟硬需求，PG + 流复制 + PgBouncer 足够到百万级用户。报告里的这条按「暂不实施」处理。

### 4.2 Redis

新依赖：`ioredis`。配置 `REDIS_URL`（optional，未配置则全部退回内存/PG 实现，保证单机可跑）。

`server/services/cache.service.ts` 提供统一接口，用途按优先级：
1. **JWKS 与签名密钥缓存**（多实例下 `keys.service.ts` 的进程内缓存会不一致）；
2. **限流**（登录、`/token`、`/device_authorization`、OTP 发送）—— 当前**完全没有限流**，这是上生产前的硬缺口；
3. **设备码轮询计数**（`slow_down` 语义在多实例下需要共享状态）；
4. **令牌撤销位图**（可选，降低 `isTokenRevoked` 对 PG 的压力）；
5. 分布式锁：用于 4.3 的定时任务选主。

### 4.3 多实例与定时任务

当前 `server.ts` 用 `setInterval` 跑清理，多副本下会重复执行。改造：
- 引入 `server/jobs/scheduler.ts`，基于 Redis 的 `SET NX PX` 做 leader 选举，或用 PG advisory lock（`pg_try_advisory_lock`）—— 后者不需要 Redis，**优先选它**。
- 需要选主的任务：令牌清理、密钥轮换、back-channel drain、UEBA 批任务、审计归档。

### 4.4 Kubernetes / Helm

- 现有 `Dockerfile` 是 distroless 两阶段构建，已经够用（`COPY auth.db` 从未存在过，better-sqlite3 编译工具链已于 2026-08 移除）。
- 新增 `deploy/helm/idp-center/`：Deployment（replicas ≥ 2）、Service、Ingress、HPA（按 CPU + `/metrics` 的 QPS）、PDB、ConfigMap、Secret（`JWT_SECRET`/`ENCRYPTION_KEY`/`DATABASE_URL`/SMTP）、`initContainer` 跑 `pnpm db:migrate`。
- 探针接 4.2 之后的 `/livez`、`/readyz`。
- **前置约束**：多副本要求 4.2（共享密钥缓存）与 4.3（任务选主）先完成，否则会出现密钥轮换竞态和重复投递。

### 4.5 微服务化 —— 建议不做

报告建议拆成 auth/oauth/identity/audit 四个服务。以当前代码规模（server 端约 5 千行）与团队体量，拆分带来的分布式事务、跨服务令牌校验、部署复杂度成本远超收益，而且会立刻碰到「auth 与 oauth 共享 `access_tokens` 表」的问题。

替代方案：**模块化单体**。阶段一已经把 `server/oauth/` 拆成独立模块，继续把 `server/identity/`（联合身份）、`server/risk/`（风险）、`server/audit/` 各自划清边界 —— 只允许通过各自的 service 层互相调用，不跨模块直接查表。用 `eslint-plugin-boundaries` 在 CI 里强制。真到了需要拆的那天，边界已经在了。

### 阶段四验证

- 多副本：本地 `docker compose` 起 3 个实例 + PG + Redis，确认令牌在任一实例签发、任一实例可验、密钥轮换只发生一次、清理任务不重复。
- 压测：`k6` 打 `/api/oidc/token` 与 `/api/oidc/introspect`，目标 P95 < 100ms @ 500 RPS。
- 迁移演练：在生产快照上跑 `pnpm db:migrate` 并计时。

---

## 全局排期约束与破坏性变更清单

按顺序执行，跳步会出事：

1. **`drizzle-kit push` 在实践中只做加法** —— 所有新增到 `clients` / `access_tokens` / `refresh_tokens` / `auth_codes` 的列必须可空或带默认值，否则对已有种子数据 push 会失败。
2. **密钥先于 RS256**（发布 A 早于 B）；**双验证先于切换**；**`server/routes/auth.ts` 与切换同提交**；**HS256 分支的移除至少晚一个发布**。
3. **`/token` 错误体形状会变**：当前客户端认证失败返回的是 `response.ts` 信封（`{error, code:'AUTH_INVALID_CREDENTIALS'}`），RFC 要求 `{error:'invalid_client'}` 且无 `code`。切换前先 grep `src/` 与 `example/` 确认消费方。`/userinfo` 同理，且应开始返回 `WWW-Authenticate: Bearer error="invalid_token"`。
4. **`/userinfo` 加上签名校验后**会开始拒绝一切非 OIDC 路径签发的令牌 —— 先确认没有内部调用方拿登录 JWT 直接打 userinfo。
5. **强制 `clients.grant_types` 会打断存量客户端**（其 `grant_types` 字符串未必列全了实际在用的类型）。先审计 `clients` 表并回填，再以 `OAUTH_ENFORCE_GRANT_TYPES` 开关的 warn-only 模式发一个版本，下个版本才真正拒绝。
6. **客户端密钥哈希化之前**，先改 `src/pages/admin/ClientsList.tsx` 为「仅创建时展示一次」—— 该页现在会回显明文密钥。
7. **`token_hash` 的回填必须与「改用哈希查找」在同一次迁移里**。
8. **`.well-known` 双挂载必须在给 `oidcRouter` 添加任何租户感知 handler 之前修掉。**
9. **OIDC 特征测试必须在 grant 注册表重构之前写完，不是之后。**
10. **风险引擎必须先跑两周影子模式**再启用拦截动作。
11. **多副本部署前必须先完成 Redis 共享缓存与任务选主**。

## 建议实施顺序（单条主线）

```
阶段0  ①合并 pg-support + 清 .env/auth.db  ②拆 .well-known  ③OIDC 特征测试
阶段1  ④schema PR：全部新表新列（默认值齐全 + 回填）
       ⑤signing_keys + keys.service + jwt.ts + middleware 双验证        [发布 A]
       ⑥server/oauth/ 抽取：errors/client-auth/registry/issue
          + authorization_code/refresh_token + 6 个既有缺陷修复（grant_types warn-only）
       ⑦RS256 切换 + routes/auth.ts 迁移 + discovery 更新                [发布 B]
       ⑧token-lookup + introspect + revoke
       ⑨client_credentials + subject_type + 机器令牌守卫
       ⑩设备码流（后端 → src/routes/device.tsx）
       ⑪oidc_sessions + sid 串联 + end_session + 前端 front-channel + back-channel 队列
       ⑫client_secret_jwt / private_key_jwt / token-exchange
       ⑬删 HS256 分支、删明文 client_secret、删 access_tokens.token       [发布 C]
       ⑭P1：动态注册 / PAR / DPoP
阶段2  ⑮MFA（mfa_factors 迁移 → Email OTP → 恢复码 → WebAuthn → SMS → step-up/acr）
       ⑯RBAC + 租户越权修复 + SCIM
       ⑰联合身份（identity-link 抽象 → OIDC RP → SAML SP → LDAP）
       ⑱审计索引/命名统一/哈希链/导出  ⑲可观测性
阶段3  ⑳风险引擎 v1（规则）→ 影子模式两周 → 启用  ㉑UEBA  ㉒LLM 辅助（人工确认）
阶段4  ㉓迁移文件化 ㉔Redis + 限流 ㉕任务选主 ㉖Helm/HPA ㉗模块边界 CI 强制
```

## 关键文件

| 文件 | 角色 |
|---|---|
| `server/schema.ts` | 全部新表新列（阶段一 6 张，阶段二 9 张，阶段三 3 张） |
| `server/routes/oidc.ts` | 从 250 行的全量实现瘦身为路由接线 |
| `server/oauth/**` | 新目录，OAuth 全部逻辑 |
| `server/middleware/auth.ts` | 双验证、机器令牌守卫、`requirePermission` |
| `server/utils/token-blacklist.ts` | 扩展 `revokeTokensBySession` 等，撤销语义不变 |
| `server/services/crypto.ts` | 复用其 `encryptToken/decryptToken`，不要另写加密 |
| `server/services/keys.service.ts` | 新增，密钥生命周期 |
| `server/routes/auth.ts` | 签名迁移、MFA 流改造、风险引擎接入点 |
| `server/routes/admin.ts` | 租户越权修复、RBAC、新管理端点 |
| `server.ts` | 路由拆分、定时任务、request-id、探针 |
| `tests/integration/oidc.test.ts` | 新增，重构的安全网 |

## 验证总纲

```bash
pnpm lint && pnpm test
```

1. 每阶段结束跑 OpenID 一致性套件对应的 test plan（basic → config → dynamic client → logout）。
2. `tests/integration/` 每个新端点配一个集成测试，沿用 `describe.skipIf` + `initDatabase()` 模式。
3. 越权类断言单独成文件（`rbac.test.ts`、`tenant-isolation.test.ts`），断言跨租户、跨客户端、机器令牌访问用户路由全部被拒。
4. 端到端：起 PG + 应用，用 `example/` 下的 Vue 示例应用跑完整登录 → 授权 → 刷新 → 登出，确认 front-channel iframe 被触发、back-channel 投递成功。
5. 破坏性变更每一项在上线前用生产数据快照演练一次迁移与回滚。
