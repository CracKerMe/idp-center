# 需求文档：P0 安全合规基座（p0-security-foundation）

## 简介

本文档描述 IDP Center 产品路线图第一阶段（P0）中两个核心安全功能模块的需求：**密码策略（Password Policy）** 与 **IP 白名单（IP Whitelist）**。

IDP Center 是一个多租户企业级身份提供商（Identity Provider），基于 Express + SQLite + JWT 构建。本阶段目标是满足企业基本信息安全审查合规要求（如等保审核、SOC2 等），收敛账号系统脆弱性，降低身份被盗用风险。

两个模块均依赖已存在的多租户数据模型（`tenants` 表及 `tenantContext` 中间件）和底层统一路由中间件作为前置依赖。

---

## 术语表

- **系统（System）**：IDP Center 认证服务，基于 Express + SQLite + JWT 构建
- **密码策略引擎（PasswordPolicyEngine）**：负责执行密码强度校验、历史密码比对、弱口令检测及轮换到期判断的模块
- **IP 白名单守卫（IPWhitelistGuard）**：负责在请求进入业务逻辑前校验来源 IP 是否在租户白名单内的中间件模块
- **租户（Tenant）**：系统中的独立组织单元，拥有独立的用户集合、密码策略配置和 IP 白名单配置
- **密码历史记录（PasswordHistory）**：存储用户历史密码哈希的记录，用于防止密码循环复用
- **弱口令字典（WeakPasswordDictionary）**：系统内置的常见弱密码列表，用于拒绝已知不安全密码
- **CIDR**：无类别域间路由（Classless Inter-Domain Routing），用于表示 IP 地址段的标准格式（如 `192.168.1.0/24`）
- **密码轮换周期（PasswordRotationPeriod）**：租户配置的强制密码更换间隔天数（默认 90 天）
- **历史密码限制数量（PasswordHistoryCount）**：租户配置的禁止复用的最近历史密码条数（默认 5 条）
- **风控预警（SecurityAlert）**：因异常访问行为触发的审计日志记录，用于安全监控和事后溯源

---

## 需求列表

---

### 需求 1：强密码合规校验

**用户故事：** 作为一名租户管理员，我希望系统能强制用户设置符合复杂度要求的密码，以便降低账号被暴力破解的风险。

#### 验收标准

1. THE PasswordPolicyEngine SHALL 对所有密码设置操作（注册、修改密码、管理员重置密码）执行强度校验
2. WHEN 用户提交的密码不包含至少一个大写字母，THE PasswordPolicyEngine SHALL 拒绝该密码并返回错误码 `PASSWORD_MISSING_UPPERCASE`
3. WHEN 用户提交的密码不包含至少一个小写字母，THE PasswordPolicyEngine SHALL 拒绝该密码并返回错误码 `PASSWORD_MISSING_LOWERCASE`
4. WHEN 用户提交的密码不包含至少一个数字，THE PasswordPolicyEngine SHALL 拒绝该密码并返回错误码 `PASSWORD_MISSING_DIGIT`
5. WHEN 用户提交的密码不包含至少一个特殊符号（非字母数字字符），THE PasswordPolicyEngine SHALL 拒绝该密码并返回错误码 `PASSWORD_MISSING_SPECIAL`
6. WHEN 用户提交的密码长度小于租户配置的最低长度（默认 8 个字符），THE PasswordPolicyEngine SHALL 拒绝该密码并返回错误码 `PASSWORD_TOO_SHORT`
7. WHEN 密码校验失败，THE 系统 SHALL 返回 HTTP 400 状态码及包含所有不合规原因列表的响应体
8. WHERE 租户已配置自定义最低密码长度，THE PasswordPolicyEngine SHALL 使用该租户的配置值替代系统默认值执行长度校验

---

### 需求 2：历史密码限制

**用户故事：** 作为一名租户管理员，我希望系统能阻止用户循环使用近期历史密码，以便防止针对性的密码重用攻击。

#### 验收标准

1. THE 系统 SHALL 在 `password_history` 表中记录每次密码变更后的密码哈希值及变更时间
2. WHEN 用户提交新密码，THE PasswordPolicyEngine SHALL 将新密码与该用户最近 N 条历史密码哈希进行比对（N 由租户配置，默认为 5）
3. WHEN 新密码与任意一条历史密码匹配，THE PasswordPolicyEngine SHALL 拒绝该密码并返回 HTTP 400 状态码及错误码 `PASSWORD_RECENTLY_USED`
4. WHEN 密码变更成功，THE 系统 SHALL 将新密码哈希插入 `password_history` 表，并保留该用户最近 N 条记录，删除超出限制的旧记录
5. WHERE 租户已配置自定义历史密码限制数量，THE PasswordPolicyEngine SHALL 使用该租户的配置值替代系统默认值执行历史比对

---

### 需求 3：密码防泄漏检查（弱口令检测）

**用户故事：** 作为一名租户管理员，我希望系统能拒绝已知的弱密码和常见密码，以便防止用户使用极易被猜测的密码。

#### 验收标准

1. THE 系统 SHALL 内置一份常见弱口令字典（WeakPasswordDictionary），包含不少于 100 个常见弱密码
2. WHEN 用户提交的密码（不区分大小写）存在于 WeakPasswordDictionary 中，THE PasswordPolicyEngine SHALL 拒绝该密码并返回 HTTP 400 状态码及错误码 `PASSWORD_TOO_COMMON`
3. THE PasswordPolicyEngine SHALL 在执行弱口令检测时忽略密码的大小写差异（即 `Password123!` 与 `password123!` 均应被检测）
4. THE WeakPasswordDictionary SHALL 支持在不重启服务的情况下通过配置文件扩展自定义弱密码条目

---

### 需求 4：定期密码轮换机制

**用户故事：** 作为一名租户管理员，我希望系统能强制用户在指定周期内更换密码，以便满足企业安全合规要求。

#### 验收标准

1. WHERE 租户已启用密码轮换策略，WHEN 用户登录时距上次密码修改时间超过租户配置的轮换周期（默认 90 天），THE 系统 SHALL 返回 HTTP 403 状态码及错误码 `PASSWORD_EXPIRED`，并在响应体中包含 `password_changed_at` 和 `expires_at` 字段
2. WHERE 租户已启用密码轮换策略，WHEN 用户成功修改密码，THE 系统 SHALL 将该用户的 `password_changed_at` 字段更新为当前时间
3. WHERE 租户已启用密码轮换策略，THE 系统 SHALL 提供专用的密码修改端点，允许密码已过期的用户在不完成完整登录流程的情况下完成密码更新
4. WHERE 租户未启用密码轮换策略，THE 系统 SHALL 不对用户登录执行密码过期检查
5. WHERE 租户已配置自定义轮换周期天数，THE 系统 SHALL 使用该租户的配置值替代系统默认值（90 天）执行过期判断

---

### 需求 5：租户密码策略配置管理

**用户故事：** 作为一名租户管理员，我希望能够为我的租户配置专属的密码策略参数，以便满足不同组织的安全合规要求。

#### 验收标准

1. THE 系统 SHALL 在 `tenant_password_policies` 表中存储每个租户的密码策略配置，包含：最低密码长度、历史密码限制数量、是否启用密码轮换、轮换周期天数
2. WHEN 租户管理员通过管理 API 更新密码策略配置，THE 系统 SHALL 持久化新配置并在后续密码操作中立即生效
3. WHEN 租户不存在自定义密码策略配置，THE PasswordPolicyEngine SHALL 使用系统默认策略（最低长度 8、历史限制 5 条、不启用轮换）
4. WHEN 租户管理员提交无效的策略参数（如最低长度小于 6 或轮换周期小于 1 天），THE 系统 SHALL 返回 HTTP 400 状态码及详细的参数校验错误信息
5. WHEN 管理员查询租户密码策略，THE 系统 SHALL 返回该租户当前生效的完整策略配置

---

### 需求 6：IP 白名单配置管理

**用户故事：** 作为一名租户管理员，我希望能够为我的租户配置受信任的 IP 地址段，以便将访问来源限制在已知的安全网络范围内。

#### 验收标准

1. THE 系统 SHALL 在 `tenant_ip_whitelist` 表中存储每个租户的 IP 白名单条目，每条记录包含：CIDR 格式的 IP 段、描述信息、创建时间、创建者 ID
2. WHEN 租户管理员添加 IP 白名单条目时提交的 CIDR 格式无效，THE 系统 SHALL 返回 HTTP 400 状态码及错误码 `INVALID_CIDR_FORMAT`
3. WHEN 租户管理员添加重复的 CIDR 条目，THE 系统 SHALL 返回 HTTP 409 状态码及错误码 `CIDR_ALREADY_EXISTS`
4. WHEN 租户管理员删除 IP 白名单条目，THE 系统 SHALL 从 `tenant_ip_whitelist` 表中移除该记录，后续请求立即按更新后的白名单执行校验
5. WHEN 管理员查询租户 IP 白名单，THE 系统 SHALL 返回该租户所有有效的白名单条目列表
6. THE 系统 SHALL 支持 IPv4 和 IPv6 两种格式的 CIDR 表达式

---

### 需求 7：IP 白名单访问控制执行

**用户故事：** 作为一名租户管理员，我希望系统能自动拦截来自非白名单 IP 的访问请求，以便实现租户级网络隔离。

#### 验收标准

1. WHERE 租户已配置至少一条 IP 白名单条目，WHEN 请求的来源 IP 不在该租户任何白名单 CIDR 范围内，THE IPWhitelistGuard SHALL 拒绝该请求并返回 HTTP 403 状态码及错误码 `IP_NOT_WHITELISTED`
2. WHERE 租户已配置至少一条 IP 白名单条目，WHEN 请求的来源 IP 在该租户至少一条白名单 CIDR 范围内，THE IPWhitelistGuard SHALL 允许该请求继续处理
3. WHERE 租户未配置任何 IP 白名单条目，THE IPWhitelistGuard SHALL 允许所有来源 IP 的请求通过，不执行 IP 校验
4. THE IPWhitelistGuard SHALL 正确处理通过反向代理转发的请求，优先从 `X-Forwarded-For` 请求头中提取真实客户端 IP
5. WHEN IPWhitelistGuard 拒绝请求，THE 系统 SHALL 在审计日志中记录一条风控预警（SecurityAlert），包含：被拒绝的来源 IP、目标租户 ID、请求路径、发生时间
6. THE IPWhitelistGuard SHALL 作为路由中间件在认证中间件之前执行，确保未授权 IP 无法触达任何业务逻辑

---

### 需求 8：IP 白名单校验的正确性

**用户故事：** 作为一名安全工程师，我希望 IP 白名单的 CIDR 匹配逻辑准确无误，以便确保访问控制策略被精确执行。

#### 验收标准

1. THE IPWhitelistGuard SHALL 正确判断一个 IPv4 地址是否属于给定的 IPv4 CIDR 段（如 `10.0.0.5` 属于 `10.0.0.0/24`，`10.0.1.5` 不属于 `10.0.0.0/24`）
2. THE IPWhitelistGuard SHALL 正确判断一个 IPv6 地址是否属于给定的 IPv6 CIDR 段
3. THE IPWhitelistGuard SHALL 正确处理边界地址（网络地址和广播地址）的匹配判断
4. WHEN 租户配置了多条 IP 白名单条目，THE IPWhitelistGuard SHALL 对所有条目执行逻辑或（OR）匹配，来源 IP 满足任意一条即视为通过
5. THE IPWhitelistGuard SHALL 将单个 IP 地址（如 `192.168.1.1/32`）视为合法的 CIDR 表达式并正确处理

---

## 正确性属性

*属性是在系统所有有效执行中都应成立的特征或行为——本质上是关于系统应做什么的形式化陈述。属性是人类可读规范与机器可验证正确性保证之间的桥梁。*

---

### 属性 1：密码复杂度校验的完备性

*对于任意* 密码字符串，PasswordPolicyEngine 的校验结果应与对该字符串逐项检查大写字母、小写字母、数字、特殊符号及长度的结果完全一致——不存在漏判或误判。

**验证需求：需求 1.2 ~ 1.6**

---

### 属性 2：弱口令检测的大小写不敏感性

*对于任意* 存在于 WeakPasswordDictionary 中的弱密码条目，其任意大小写变体（如全大写、首字母大写、混合大小写）均应被 PasswordPolicyEngine 拒绝。

**验证需求：需求 3.2、需求 3.3**

---

### 属性 3：历史密码比对的轮转正确性（Round-Trip 属性）

*对于任意* 用户，在连续修改密码 N+1 次后（N 为历史限制数量），第 1 次使用的密码应可以被再次设置（因为它已超出历史记录窗口），而第 N+1 次之前的任意密码均应被拒绝。

**验证需求：需求 2.2、需求 2.4**

---

### 属性 4：历史密码记录数量不超过限制（不变量）

*对于任意* 用户，在任意时刻，`password_history` 表中该用户的记录数量不应超过租户配置的历史密码限制数量 N。

**验证需求：需求 2.4**

---

### 属性 5：密码过期判断的时间一致性

*对于任意* 用户，密码过期判断应基于 `CURRENT_TIMESTAMP - password_changed_at >= rotation_period_days * 86400 秒`，计算结果与实际拒绝/放行行为完全一致，误差不超过 1 秒。

**验证需求：需求 4.1**

---

### 属性 6：IP 白名单 CIDR 匹配的正确性（模型对比属性）

*对于任意* IP 地址和 CIDR 段的组合，IPWhitelistGuard 的匹配结果应与标准 CIDR 计算库（参考实现）的结果完全一致——不存在误放行或误拦截。

**验证需求：需求 8.1、需求 8.2、需求 8.3**

---

### 属性 7：多条白名单的逻辑或语义（幂等性）

*对于任意* 租户的 IP 白名单条目集合，向集合中添加一条已被现有条目覆盖的 CIDR 段，不应改变任何 IP 地址的访问控制结果。

**验证需求：需求 8.4**

---

### 属性 8：无白名单配置时的全通策略

*对于任意* 未配置 IP 白名单的租户，来自任意 IP 地址的请求均应通过 IPWhitelistGuard 的校验，不应被拒绝。

**验证需求：需求 7.3**

---

### 属性 9：IP 拦截必然产生审计记录

*对于任意* 被 IPWhitelistGuard 拒绝的请求，`audit_logs` 表中必然存在一条对应的风控预警记录，且该记录包含正确的来源 IP、租户 ID 和请求路径。

**验证需求：需求 7.5**

---

### 属性 10：租户策略隔离性（不变量）

*对于任意* 两个不同租户 A 和 B，修改租户 A 的密码策略或 IP 白名单配置，不应影响租户 B 的策略配置和访问控制行为。

**验证需求：需求 5.1 ~ 5.5、需求 6.1 ~ 6.5**
