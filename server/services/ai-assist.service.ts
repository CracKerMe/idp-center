import Anthropic from '@anthropic-ai/sdk';
import { and, gte, eq, desc } from 'drizzle-orm';
import { db } from '../database.js';
import { auditLogs, loginEvents, tenants, tenantPasswordPolicies, tenantIpWhitelist, tenantMfaPolicies } from '../schema.js';
import { config } from '../config.js';
import { redactPII, redactObject } from '../utils/redact.js';
import { logger } from '../utils/logger.js';

// Batch summarization/report generation doesn't need Opus-tier reasoning; root-cause-style
// investigation (buildInvestigationBrief) does. Kept as two constants rather than one so a
// future call site can pick deliberately instead of guessing.
const SUMMARY_MODEL = 'claude-sonnet-5';
const INVESTIGATION_MODEL = 'claude-opus-5';
const MAX_TOKENS = 2048;

let client: Anthropic | null | undefined; // undefined = not yet initialized, null = disabled

function getClient(): Anthropic | null {
  if (client === undefined) {
    client = config.ANTHROPIC_API_KEY ? new Anthropic({ apiKey: config.ANTHROPIC_API_KEY }) : null;
  }
  return client;
}

export function isAiAssistEnabled(): boolean {
  return getClient() !== null;
}

export class AiAssistDisabledError extends Error {
  constructor() {
    super('AI-assisted tooling is disabled — set ANTHROPIC_API_KEY to enable it');
    this.name = 'AiAssistDisabledError';
  }
}

function requireClient(): Anthropic {
  const c = getClient();
  if (!c) throw new AiAssistDisabledError();
  return c;
}

async function complete(model: string, system: string, userPrompt: string): Promise<string> {
  const c = requireClient();
  const response = await c.messages.create({
    model,
    max_tokens: MAX_TOKENS,
    system,
    messages: [{ role: 'user', content: userPrompt }],
  });
  const block = response.content.find((b) => b.type === 'text');
  return block && block.type === 'text' ? block.text : '';
}

// ─── 3.3.1 Audit summary & investigation assistant ─────────────────────────

export interface AuditSummaryResult {
  summary: string;
  windowStart: string;
  windowEnd: string;
  eventCount: number;
}

/**
 * Summarizes a tenant's recent audit_logs + login_events into a natural-language report
 * with recommendations. This never feeds a decision back into any enforcement path — it's
 * read-only admin tooling (implementation plan §3.3 red line: "任何 LLM 输出都不得直接成为鉴权决策").
 */
export async function generateAuditSummary(tenantId: string, days: number): Promise<AuditSummaryResult> {
  const windowStart = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  const windowEnd = new Date();

  const [logs, events] = await Promise.all([
    db.select({ action: auditLogs.action, userId: auditLogs.userId, createdAt: auditLogs.createdAt, details: auditLogs.details })
      .from(auditLogs)
      .where(and(eq(auditLogs.tenantId, tenantId), gte(auditLogs.createdAt, windowStart)))
      .orderBy(desc(auditLogs.createdAt))
      .limit(500),
    db.select({ outcome: loginEvents.outcome, riskScore: loginEvents.riskScore, riskAction: loginEvents.riskAction, country: loginEvents.country, createdAt: loginEvents.createdAt })
      .from(loginEvents)
      .where(and(eq(loginEvents.tenantId, tenantId), gte(loginEvents.createdAt, windowStart)))
      .orderBy(desc(loginEvents.createdAt))
      .limit(500),
  ]);

  const redactedPayload = redactObject({ auditLogs: logs, loginEvents: events });
  const prompt =
    `以下是某租户过去 ${days} 天的审计日志与登录事件样本（JSON，已脱敏，最多各 500 条）。\n` +
    `请给出：1) 关键活动摘要 2) 值得关注的异常/风险模式 3) 具体可执行的安全建议（不超过5条）。\n` +
    `只依据给出的数据，不要编造未出现的事件。\n\n${JSON.stringify(redactedPayload)}`;

  const summary = await complete(
    SUMMARY_MODEL,
    '你是企业 IDP 系统的安全审计助手。你的输出仅供管理员参考，绝不会被系统自动执行为任何鉴权或封禁决策。',
    prompt
  );

  return { summary, windowStart: windowStart.toISOString(), windowEnd: windowEnd.toISOString(), eventCount: logs.length + events.length };
}

/** Deeper root-cause style brief for a single incident — uses the higher-reasoning model. */
export async function buildInvestigationBrief(tenantId: string, question: string, contextJson: unknown): Promise<string> {
  const redacted = redactObject(contextJson);
  const prompt =
    `租户 ${tenantId} 的一起安全事件调查请求。管理员的问题：${redactPII(question)}\n\n` +
    `相关上下文数据（已脱敏）：${JSON.stringify(redacted)}\n\n` +
    `请给出根因分析假设（按可能性排序）与下一步排查建议。`;
  return complete(INVESTIGATION_MODEL, '你是企业 IDP 系统的安全事件调查助手，只产出分析与建议，不做任何自动化操作。', prompt);
}

// ─── 3.3.2 Natural-language policy drafting ─────────────────────────────────

export interface RiskPolicyDraft {
  name: string;
  minScore: number;
  maxScore: number;
  action: 'allow' | 'mfa_required' | 'step_up' | 'deny' | 'notify';
  rationale: string;
}

/**
 * Turns a plain-language policy request into a structured risk_policies draft. The result
 * is NEVER written to the database here — POST /api/admin/ai/policy-draft only returns it;
 * an admin must separately call the existing POST /api/admin/risk/policies endpoint to apply
 * it. This split is intentional (implementation plan §3.3: "必须人工确认后才生效").
 */
export async function draftRiskPolicy(instruction: string): Promise<RiskPolicyDraft> {
  const system =
    '你是企业 IDP 系统的风险策略助手。把管理员的自然语言描述转换成一条结构化的风险策略草案，' +
    '只输出一个 JSON 对象，字段为 name(string) minScore(0-100的整数) maxScore(0-100的整数，>=minScore) ' +
    'action(allow|mfa_required|step_up|deny|notify 之一) rationale(string，简要说明为何这样设置分数区间和动作)。' +
    '不要输出 JSON 之外的任何文字。这条策略只是草案，不会被自动应用。';

  const raw = await complete(SUMMARY_MODEL, system, redactPII(instruction));

  let parsed: RiskPolicyDraft;
  try {
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    parsed = JSON.parse(jsonMatch ? jsonMatch[0] : raw);
  } catch (err: any) {
    throw new Error(`Model did not return valid JSON: ${err.message}`);
  }

  if (!parsed.name || typeof parsed.minScore !== 'number' || typeof parsed.maxScore !== 'number' || !parsed.action) {
    throw new Error('Model output missing required policy fields');
  }
  return parsed;
}

// ─── 3.3.3 Compliance gap check ─────────────────────────────────────────────

export interface ComplianceGapResult {
  standard: 'soc2' | 'gdpr';
  report: string;
}

/** Feeds current tenant configuration (never user data) to the model for a gap analysis. */
export async function generateComplianceGapCheck(tenantId: string, standard: 'soc2' | 'gdpr'): Promise<ComplianceGapResult> {
  const [[tenant], [passwordPolicy], ipWhitelist, [mfaPolicy]] = await Promise.all([
    db.select().from(tenants).where(eq(tenants.id, tenantId)).limit(1),
    db.select().from(tenantPasswordPolicies).where(eq(tenantPasswordPolicies.tenantId, tenantId)).limit(1),
    db.select({ cidr: tenantIpWhitelist.cidr }).from(tenantIpWhitelist).where(eq(tenantIpWhitelist.tenantId, tenantId)),
    db.select().from(tenantMfaPolicies).where(eq(tenantMfaPolicies.tenantId, tenantId)).limit(1),
  ]);

  const configSnapshot = redactObject({
    tenant: tenant ? { name: tenant.name, isActive: tenant.isActive } : null,
    passwordPolicy: passwordPolicy || null,
    ipWhitelistEntryCount: ipWhitelist.length,
    mfaPolicy: mfaPolicy || null,
  });

  const prompt =
    `以下是某租户当前的安全配置快照（JSON）。请对照 ${standard.toUpperCase()} 的常见要求，` +
    `输出一份差距清单：每一项包含「要求」「当前状态」「差距」「建议」。只依据给出的配置，不要假设未提供的信息。\n\n` +
    JSON.stringify(configSnapshot);

  const report = await complete(SUMMARY_MODEL, '你是企业安全合规助手，只产出分析建议，不做任何自动配置变更。', prompt);
  logger.info(`Generated ${standard} compliance gap check for tenant ${tenantId}`);
  return { standard, report };
}
