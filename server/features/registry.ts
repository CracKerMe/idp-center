import { config } from '../config.js';

export type TriState = 'off' | 'shadow' | 'enforce';
export type FeatureCategory = 'observability' | 'security' | 'auth' | 'ai';

interface FeatureFlagBase {
  category: FeatureCategory;
  categoryLabel: string;      // '运维可观测' | '安全风控' | '认证能力' | 'AI 辅助'
  label: string;               // 简短中文名，如 '告警系统'
  description: string;         // 中文说明
  effect: 'immediate' | 'restart-required';
  /** 必须同时为真才能开启的其他 key（松散校验为 string[]，避免 registry 自引用）。 */
  dependsOn?: readonly string[];
  /**
   * env 层面的硬前置条件——DB 覆盖无法突破。例如未配置 GitHub 凭据时，即使 DB 写 true，
   * 解析值仍被钳制为 false（见 feature.service.ts 的 clampToHardRequirement）。
   */
  hardRequirement?: { met: () => boolean; reasonZh: string };
  /** 为 false 表示该开关仅登记占位，尚无实际读取它的子系统实现。 */
  implemented: boolean;
}

interface BooleanFlag extends FeatureFlagBase {
  type: 'boolean';
  envDefault: () => boolean;
}

interface TriStateFlag extends FeatureFlagBase {
  type: 'triState';
  options: readonly TriState[];
  envDefault: () => TriState;
}

export type FeatureFlagDef = BooleanFlag | TriStateFlag;

export const FEATURE_REGISTRY = {
  alert: {
    type: 'boolean', category: 'observability', categoryLabel: '运维可观测',
    label: '告警系统',
    description: '事件触发的告警规则匹配与分发（SSE/Webhook）。关闭后新事件不再生成告警，历史告警仍可查看。',
    effect: 'immediate', implemented: true, envDefault: () => true,
  },
  autoHeal: {
    type: 'boolean', category: 'observability', categoryLabel: '运维可观测',
    label: '自动修复',
    description: '健康检查驱动的自动修复动作（对应 AUTO_HEAL_ENABLED）。',
    effect: 'immediate', implemented: true, envDefault: () => config.AUTO_HEAL_ENABLED,
  },
  healthChecker: {
    type: 'boolean', category: 'observability', categoryLabel: '运维可观测',
    label: '健康检查',
    description: '综合健康检查的定时执行与历史记录持久化（不影响 /livez /readyz 探活端点）。',
    effect: 'immediate', implemented: true, envDefault: () => true,
  },
  eventStorePersistence: {
    type: 'boolean', category: 'observability', categoryLabel: '运维可观测',
    label: '事件持久化存储',
    description: '将事件总线事件写入 event_store 表（对应 EVENT_STORE_ENABLED）。当前尚无消费方实现此持久化逻辑，开关仅为登记占位。',
    effect: 'restart-required', implemented: false, envDefault: () => config.EVENT_STORE_ENABLED,
  },
  capacityForecast: {
    type: 'boolean', category: 'observability', categoryLabel: '运维可观测',
    label: '容量预测',
    description: '容量预测定时任务（对应 CAPACITY_FORECAST_ENABLED）。当前尚无任务实现，开关为登记占位。',
    effect: 'restart-required', implemented: false, envDefault: () => config.CAPACITY_FORECAST_ENABLED,
  },
  alertAiEnrichment: {
    type: 'boolean', category: 'observability', categoryLabel: '运维可观测',
    label: '告警 AI 富化',
    description: '用 LLM 为告警补充上下文（对应 ALERT_AI_ENRICHMENT）。当前尚无实现，开关为登记占位；实际启用还需 AI 辅助总开关开启。',
    effect: 'immediate', implemented: false, envDefault: () => config.ALERT_AI_ENRICHMENT,
    dependsOn: ['aiAssist'],
  },
  riskEngine: {
    type: 'triState', category: 'security', categoryLabel: '安全风控',
    label: '风险引擎',
    description: '登录风险评分模式：off 完全跳过；shadow 仅评分记录不阻断；enforce 按策略执行。对应 RISK_ENGINE_MODE。',
    effect: 'immediate', implemented: true, options: ['off', 'shadow', 'enforce'],
    envDefault: () => config.RISK_ENGINE_MODE,
  },
  captcha: {
    type: 'triState', category: 'security', categoryLabel: '安全风控',
    label: '滑块验证码',
    description: '登录失败次数触发的验证码模式，对应 CAPTCHA_MODE。',
    effect: 'immediate', implemented: true, options: ['off', 'shadow', 'enforce'],
    envDefault: () => config.CAPTCHA_MODE,
  },
  uebaBaseline: {
    type: 'boolean', category: 'security', categoryLabel: '安全风控',
    label: 'UEBA 基线任务',
    description: '用户行为基线的夜间全量重算任务。',
    effect: 'immediate', implemented: true, envDefault: () => true,
  },
  mfa: {
    type: 'boolean', category: 'auth', categoryLabel: '认证能力',
    label: '多因素认证',
    description: '用户自助注册新的 MFA 因子（TOTP/短信/邮箱）。关闭仅阻止新注册，已注册用户的登录校验、查看、解绑不受影响。',
    effect: 'immediate', implemented: true, envDefault: () => true,
  },
  githubSso: {
    type: 'boolean', category: 'auth', categoryLabel: '认证能力',
    label: 'GitHub 登录',
    description: '通过 GitHub OAuth 登录/注册。',
    effect: 'immediate', implemented: true,
    envDefault: () => !!(config.GITHUB_CLIENT_ID && config.GITHUB_CLIENT_SECRET),
    hardRequirement: {
      met: () => !!(config.GITHUB_CLIENT_ID && config.GITHUB_CLIENT_SECRET),
      reasonZh: '需要先配置 GITHUB_CLIENT_ID / GITHUB_CLIENT_SECRET',
    },
  },
  deviceFlow: {
    type: 'boolean', category: 'auth', categoryLabel: '认证能力',
    label: '设备码流程',
    description: 'OAuth Device Authorization Grant（无浏览器设备登录）。',
    effect: 'immediate', implemented: true, envDefault: () => true,
  },
  dynamicClientRegistration: {
    type: 'boolean', category: 'auth', categoryLabel: '认证能力',
    label: '动态客户端注册',
    description: 'RFC 7591 动态客户端注册总开关；关闭后对所有租户生效，即使租户设置里单独启用了 dynamicClientRegistration 也不可用。',
    effect: 'immediate', implemented: true, envDefault: () => true,
  },
  aiAssist: {
    type: 'boolean', category: 'ai', categoryLabel: 'AI 辅助',
    label: 'AI 辅助管理工具',
    description: '审计摘要 / 策略草拟 / 合规检查等 LLM 辅助端点。',
    effect: 'immediate', implemented: true,
    envDefault: () => !!config.ANTHROPIC_API_KEY,
    hardRequirement: { met: () => !!config.ANTHROPIC_API_KEY, reasonZh: '需要先配置 ANTHROPIC_API_KEY' },
  },
} as const satisfies Record<string, FeatureFlagDef>;

export type FeatureKey = keyof typeof FEATURE_REGISTRY;

export type ResolvedValue<K extends FeatureKey> =
  (typeof FEATURE_REGISTRY)[K] extends { type: 'triState' } ? TriState : boolean;

// Startup assertion: every dependsOn entry must point at a real registry key. Catches typos
// immediately at import time instead of silently no-op'ing a dependency check at runtime.
for (const [key, def] of Object.entries(FEATURE_REGISTRY)) {
  for (const dep of (def as FeatureFlagDef).dependsOn ?? []) {
    if (!(dep in FEATURE_REGISTRY)) {
      throw new Error(`feature registry: '${key}' depends on unknown feature '${dep}'`);
    }
  }
}
