# Implementation Plan: P0 安全合规基座（p0-security-foundation）

## Overview

本实现计划将 P0 安全合规基座的设计拆分为增量式编码任务，涵盖密码策略引擎（PasswordPolicyEngine）和 IP 白名单守卫（IPWhitelistGuard）两个模块。每个任务构建在前一个任务之上，确保无孤立代码。属性测试使用 fast-check，最低 100 次迭代。

## Tasks

- [x] 1. Database schema and error codes foundation
  - [x] 1.1 Add new error codes to `ErrorCode` enum in `server/utils/response.ts`
    - Append `PASSWORD_MISSING_UPPERCASE`, `PASSWORD_MISSING_LOWERCASE`, `PASSWORD_MISSING_DIGIT`, `PASSWORD_MISSING_SPECIAL`, `PASSWORD_TOO_SHORT`, `PASSWORD_TOO_COMMON`, `PASSWORD_RECENTLY_USED`, `PASSWORD_EXPIRED`, `IP_NOT_WHITELISTED`, `INVALID_CIDR_FORMAT`, `CIDR_ALREADY_EXISTS` to the `ErrorCode` enum
    - _Requirements: 1.2, 1.3, 1.4, 1.5, 1.6, 3.2, 2.3, 4.1, 7.1, 6.2, 6.3_

  - [x] 1.2 Add new database tables and indexes in `server/database.ts`
    - Append `CREATE TABLE IF NOT EXISTS tenant_password_policies` with columns: id, tenant_id (UNIQUE), min_length, history_count, rotation_enabled, rotation_period_days, created_at, updated_at
    - Append `CREATE TABLE IF NOT EXISTS password_history` with columns: id, user_id, tenant_id, password_hash, created_at
    - Append `CREATE TABLE IF NOT EXISTS tenant_ip_whitelist` with columns: id, tenant_id, cidr, description, created_by, created_at, with UNIQUE(tenant_id, cidr)
    - Create indexes: `idx_password_history_user` on password_history(user_id, created_at), `idx_ip_whitelist_tenant` on tenant_ip_whitelist(tenant_id)
    - _Requirements: 2.1, 5.1, 6.1_

- [x] 2. Weak password dictionary module
  - [x] 2.1 Create `server/utils/weak-passwords.ts`
    - Export a `Set<string>` named `weakPasswords` containing at least 100 common weak passwords, all stored lowercase
    - Implement `loadWeakPasswords()` that merges built-in list with optional custom file from `WEAK_PASSWORDS_FILE` env var (using `fs.readFileSync`, no async)
    - Export `isWeakPassword(password: string): boolean` that checks `password.toLowerCase()` against the set
    - _Requirements: 3.1, 3.2, 3.3, 3.4_

  - [ ]* 2.2 Write unit tests for weak password dictionary (`tests/weak-passwords.test.ts`)
    - Test that built-in dictionary has >= 100 entries
    - Test `isWeakPassword` returns true for known weak passwords
    - Test case-insensitive matching (e.g., 'PASSWORD', 'Password', 'pAsSwOrD')
    - Test that strong passwords are not flagged
    - _Requirements: 3.1, 3.2, 3.3_

- [x] 3. PasswordPolicyEngine core implementation
  - [x] 3.1 Create `server/services/password-policy.service.ts`
    - Export interfaces: `TenantPasswordPolicy`, `PolicyViolation`, `PolicyValidationResult`
    - Export `DEFAULT_PASSWORD_POLICY` constant: `{ min_length: 8, history_count: 5, rotation_enabled: false, rotation_period_days: 90 }`
    - Implement `getTenantPasswordPolicy(tenantId: string): TenantPasswordPolicy` — query `tenant_password_policies` table, fall back to defaults
    - Implement `validatePassword(password: string, userId: string | null, tenantId: string): PolicyValidationResult` with the full validation chain: strength checks (uppercase, lowercase, digit, special, length), weak password detection via `isWeakPassword()`, and history comparison via `bcrypt.compareSync` when userId is not null
    - Collect ALL violations before returning (no early return)
    - Implement `recordPasswordHistory(userId: string, passwordHash: string, tenantId: string): void` — INSERT new record, DELETE records exceeding history_count limit
    - Implement `isPasswordExpired(passwordChangedAt: string | null, tenantId: string): { expired: boolean; expiresAt: string | null }` — check rotation_enabled, compute time difference against rotation_period_days
    - All database operations use synchronous better-sqlite3 API
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7, 1.8, 2.1, 2.2, 2.3, 2.4, 2.5, 3.2, 3.3, 4.1, 4.2, 4.4, 4.5, 5.3_

  - [ ]* 3.2 Write unit tests for PasswordPolicyEngine (`tests/password-policy.test.ts`)
    - Test strength validation: missing uppercase, missing lowercase, missing digit, missing special, too short
    - Test multiple violations returned simultaneously
    - Test weak password detection integration
    - Test `getTenantPasswordPolicy` with and without custom config
    - Test `isPasswordExpired` with rotation enabled/disabled, various time differences
    - Test `recordPasswordHistory` inserts and prunes correctly
    - Use in-memory better-sqlite3 database for isolation
    - _Requirements: 1.2, 1.3, 1.4, 1.5, 1.6, 1.7, 1.8, 2.2, 2.3, 2.4, 3.2, 4.1, 4.4, 5.3_

  - [ ]* 3.3 Write property test: Password complexity completeness (`tests/password-policy.property.test.ts`)
    - **Property 1: 密码复杂度校验的完备性**
    - Generate passwords missing specific character classes using `fc.stringOf` with constrained character sets
    - Verify corresponding error codes are present/absent based on character class presence
    - Generate passwords satisfying all criteria and verify no complexity violations
    - Minimum 100 iterations
    - **Validates: Requirements 1.2, 1.3, 1.4, 1.5, 1.6, 1.8**

  - [ ]* 3.4 Write property test: Weak password case-insensitive detection (`tests/password-policy.property.test.ts`)
    - **Property 2: 弱口令检测的大小写不敏感性**
    - Pick random entries from `weakPasswords` set, generate random case variants
    - Verify all variants return `PASSWORD_TOO_COMMON` violation
    - Minimum 100 iterations
    - **Validates: Requirements 3.2, 3.3**

  - [ ]* 3.5 Write property test: History password rejection (`tests/password-policy.property.test.ts`)
    - **Property 3: 历史密码比对的拒绝正确性**
    - Generate N passwords, record them as history, attempt to reuse each one
    - Verify all are rejected with `PASSWORD_RECENTLY_USED`
    - Use in-memory database per test run
    - Minimum 100 iterations
    - **Validates: Requirements 2.2, 2.3**

  - [ ]* 3.6 Write property test: History record count invariant (`tests/password-policy.property.test.ts`)
    - **Property 4: 历史密码记录数量不变量**
    - Generate random history_count N and change count K (K > N), execute K password changes
    - Verify record count for user never exceeds N
    - Use in-memory database per test run
    - Minimum 100 iterations
    - **Validates: Requirements 2.4, 2.5**

  - [ ]* 3.7 Write property test: Password expiration time consistency (`tests/password-policy.property.test.ts`)
    - **Property 5: 密码过期判断的时间一致性**
    - Generate random `password_changed_at` timestamps and `rotation_period_days` values
    - Verify `isPasswordExpired` result matches manual time-difference calculation
    - Verify rotation_enabled=false always returns not expired
    - Minimum 100 iterations
    - **Validates: Requirements 4.1, 4.4, 4.5**

- [x] 4. Checkpoint — Ensure all password policy tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 5. IP whitelist CIDR matching and middleware
  - [x] 5.1 Create `server/middleware/ip-whitelist.ts`
    - Implement `ipv4ToInt(ip: string): number` — convert IPv4 string to 32-bit unsigned integer
    - Implement `isIpv4InCidr(ip: string, cidr: string): boolean` — bitwise mask comparison
    - Implement `expandIpv6(ip: string): string` — expand shorthand IPv6 to full 8-group notation
    - Implement `ipv6ToBigInt(ip: string): bigint` — convert expanded IPv6 to BigInt
    - Implement `isIpv6InCidr(ip: string, cidr: string): boolean` — BigInt mask comparison
    - Implement `isIpInCidr(ip: string, cidr: string): boolean` — dispatch to IPv4 or IPv6 matcher
    - Implement `parseCidr(cidr: string): { ip: string; prefix: number; version: 4 | 6 } | null` — validate CIDR format
    - Implement `extractClientIp(req: express.Request): string` — extract from X-Forwarded-For header, fall back to req.ip / req.socket.remoteAddress
    - Implement and export `ipWhitelistGuard` middleware: query `tenant_ip_whitelist` for `req.tenantId`, if no entries call `next()`, otherwise check client IP against all CIDRs (logical OR), block with 403 `IP_NOT_WHITELISTED` and `logAudit` on failure
    - Export helper functions (`parseCidr`, `isIpInCidr`, `isIpv4InCidr`, `isIpv6InCidr`, `expandIpv6`) for testing
    - _Requirements: 6.6, 7.1, 7.2, 7.3, 7.4, 7.5, 7.6, 8.1, 8.2, 8.3, 8.4, 8.5_

  - [ ]* 5.2 Write unit tests for CIDR matching (`tests/ip-whitelist-cidr.test.ts`)
    - Test `parseCidr` with valid/invalid IPv4 and IPv6 CIDRs
    - Test `isIpv4InCidr` with known in-range and out-of-range IPs, /32 single-host, /0 match-all
    - Test `isIpv6InCidr` with known in-range and out-of-range IPs, /128 single-host
    - Test `expandIpv6` with shorthand notations (::1, ::, fe80::1)
    - Test `extractClientIp` with single IP, comma-separated chain, missing header
    - Test boundary addresses (network address and broadcast address)
    - _Requirements: 8.1, 8.2, 8.3, 8.5_

  - [ ]* 5.3 Write property test: CIDR matching correctness (`tests/ip-whitelist.property.test.ts`)
    - **Property 6: CIDR 匹配正确性（模型对比）**
    - Generate random IPv4 addresses and CIDR ranges using `fc.ipV4()` and `fc.integer`
    - Implement a reference CIDR matcher as an independent pure function
    - Verify `isIpv4InCidr` and `isIpv6InCidr` match the reference implementation for all generated inputs
    - Include /32 and /0 edge cases for IPv4, /128 and /0 for IPv6
    - Minimum 100 iterations
    - **Validates: Requirements 8.1, 8.2, 8.3, 8.5**

  - [ ]* 5.4 Write property test: Access control matches CIDR semantics (`tests/ip-whitelist.property.test.ts`)
    - **Property 7: 访问控制结果与 CIDR 匹配语义一致**
    - Generate random whitelist entry sets (1-5 CIDRs) and random client IPs
    - Verify middleware allow/deny decision matches manual logical-OR CIDR check
    - Minimum 100 iterations
    - **Validates: Requirements 7.1, 7.2, 8.4**

  - [ ]* 5.5 Write property test: No whitelist means allow-all (`tests/ip-whitelist.property.test.ts`)
    - **Property 8: 无白名单配置时的全通策略**
    - Generate arbitrary IP addresses
    - Verify all pass when tenant has no whitelist entries
    - Use in-memory database per test run
    - Minimum 100 iterations
    - **Validates: Requirements 7.3**

  - [ ]* 5.6 Write property test: IP block produces audit record (`tests/ip-whitelist.property.test.ts`)
    - **Property 9: IP 拦截必然产生审计记录**
    - Generate blocked request scenarios (IP not in whitelist)
    - Verify audit_logs table contains a record with correct blocked_ip, tenant_id, and path
    - Use in-memory database per test run
    - Minimum 100 iterations
    - **Validates: Requirements 7.5**

  - [ ]* 5.7 Write property test: Tenant policy isolation (`tests/ip-whitelist.property.test.ts`)
    - **Property 10: 租户策略隔离性**
    - Generate two tenants with random password policies and IP whitelist configs
    - Modify tenant A's config, verify tenant B's config and access control behavior unchanged
    - Use in-memory database per test run
    - Minimum 100 iterations
    - **Validates: Requirements 5.1~5.5, 6.1~6.5**

- [x] 6. Checkpoint — Ensure all IP whitelist tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 7. Zod validation schemas
  - [x] 7.1 Add password policy schema to `server/validators/admin.validator.ts`
    - Export `passwordPolicySchema = z.object({ min_length: z.number().int().min(6).max(128), history_count: z.number().int().min(1).max(24), rotation_enabled: z.boolean(), rotation_period_days: z.number().int().min(1).max(365) })`
    - Export `ipWhitelistEntrySchema = z.object({ cidr: z.string().min(1), description: z.string().max(255).optional() })`
    - _Requirements: 5.4, 6.2_

  - [x] 7.2 Add change-expired-password schema to `server/validators/auth.validator.ts`
    - Export `changeExpiredPasswordSchema = z.object({ username: z.string().min(1), current_password: z.string().min(1), new_password: z.string().min(1) })`
    - _Requirements: 4.3_

- [x] 8. Admin API routes for password policy and IP whitelist
  - [x] 8.1 Add password policy management endpoints to `server/routes/admin.ts`
    - `GET /tenants/:tenantId/password-policy` — call `getTenantPasswordPolicy`, return with `success()`
    - `PUT /tenants/:tenantId/password-policy` — validate with `passwordPolicySchema`, UPSERT into `tenant_password_policies`, return with `message()`
    - Both endpoints use `authenticateAdmin` middleware
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5_

  - [x] 8.2 Add IP whitelist CRUD endpoints to `server/routes/admin.ts`
    - `GET /tenants/:tenantId/ip-whitelist` — query all entries for tenant, return with `success()`
    - `POST /tenants/:tenantId/ip-whitelist` — validate with `ipWhitelistEntrySchema`, call `parseCidr()` for format validation, INSERT with UNIQUE constraint handling, `logAudit('IP_WHITELIST_ADDED')`, return 201 with `success()`
    - `DELETE /tenants/:tenantId/ip-whitelist/:entryId` — verify entry exists and belongs to tenant, DELETE, `logAudit('IP_WHITELIST_REMOVED')`, return with `message()`
    - All endpoints use `authenticateAdmin` middleware
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5, 6.6_

- [x] 9. Auth routes integration and password.ts deprecation
  - [x] 9.1 Add password expiry check to login flow in `server/routes/auth.ts`
    - After OTP verification / successful credential check, before generating access token, call `isPasswordExpired(user.password_changed_at, tenantId)`
    - If expired, return 403 with `PASSWORD_EXPIRED` error code and `{ password_changed_at, expires_at }` in response data
    - _Requirements: 4.1, 4.4_

  - [x] 9.2 Add `POST /password/change-expired` endpoint to `server/routes/auth.ts`
    - Validate with `changeExpiredPasswordSchema` (no `authenticateToken` middleware)
    - Verify username + current_password via `bcrypt.compareSync`
    - Confirm tenant has rotation enabled and password is actually expired (return 403 if not expired)
    - Call `validatePassword(new_password, userId, tenantId)` — return 400 with violations if invalid
    - Update `password_hash` and `password_changed_at` in users table
    - Call `recordPasswordHistory(userId, newHash, tenantId)`
    - Write audit log `PASSWORD_CHANGED_EXPIRED`
    - Return 200 with `message('Password changed successfully')`
    - _Requirements: 4.2, 4.3_

  - [x] 9.3 Replace `validatePasswordStrength` calls with `validatePassword` in auth routes
    - Update register endpoint to use `validatePassword(password, null, tenantId)` and call `recordPasswordHistory` after successful registration
    - Update password reset endpoint to use `validatePassword(password, userId, tenantId)` and call `recordPasswordHistory` after successful reset
    - _Requirements: 1.1_

  - [x] 9.4 Deprecate `validatePasswordStrength` in `server/utils/password.ts`
    - Add `@deprecated` JSDoc comment directing to `PasswordPolicyEngine.validatePassword()`
    - Optionally delegate implementation to `validatePassword` with default tenant for backward compatibility
    - _Requirements: 1.1_

- [x] 10. Register IPWhitelistGuard middleware in `server.ts`
  - Import `ipWhitelistGuard` from `./server/middleware/ip-whitelist.js`
  - Register `app.use('/api', ipWhitelistGuard)` after `app.use('/api', tenantContext)` and before all route registrations
  - _Requirements: 7.6_

- [x] 11. Checkpoint — Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 12. Integration tests
  - [ ]* 12.1 Write integration tests for password policy API (`tests/integration/password-policy-api.test.ts`)
    - Test GET/PUT password policy CRUD flow
    - Test registration with new password policy engine (strength, weak password, history)
    - Test login with password expiry check (rotation enabled, expired password returns 403)
    - Test `POST /api/auth/password/change-expired` full flow (success, wrong current password, password not expired, new password violates policy)
    - Test admin reset password uses new engine
    - _Requirements: 1.1, 1.7, 2.1, 2.3, 4.1, 4.2, 4.3, 5.2, 5.4, 5.5_

  - [ ]* 12.2 Write integration tests for IP whitelist API (`tests/integration/ip-whitelist-api.test.ts`)
    - Test GET/POST/DELETE IP whitelist CRUD flow
    - Test invalid CIDR format returns 400 `INVALID_CIDR_FORMAT`
    - Test duplicate CIDR returns 409 `CIDR_ALREADY_EXISTS`
    - Test IPWhitelistGuard blocks non-whitelisted IP (403 `IP_NOT_WHITELISTED`)
    - Test IPWhitelistGuard allows whitelisted IP
    - Test no whitelist entries means all IPs pass
    - Test audit log created on IP block
    - _Requirements: 6.2, 6.3, 6.4, 6.5, 7.1, 7.2, 7.3, 7.5_

- [x] 13. Final checkpoint — Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Property tests validate universal correctness properties from the design document (Properties 1-10)
- Unit tests validate specific examples and edge cases
- All database operations use synchronous better-sqlite3 API — no async/await
- Test files use in-memory SQLite databases for isolation
- fast-check property tests use minimum 100 iterations (`{ numRuns: 100 }`)
