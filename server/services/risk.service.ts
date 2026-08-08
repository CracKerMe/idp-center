import crypto from 'crypto';
import { and, eq, desc, gte, sql } from 'drizzle-orm';
import { db } from '../database.js';
import { loginEvents, userBehaviorBaselines, riskPolicies } from '../schema.js';
import { getValue } from './feature.service.js';
import { lookupGeo, haversineKm } from './geoip.service.js';
import { logger } from '../utils/logger.js';
import { riskAssessments, riskScoreHistogram } from '../utils/metrics.js';
import { eventBus } from './event-bus.service.js';

export interface RiskSignal {
  code: string;
  weight: number;
  detail?: string;
}

export type RiskAction = 'allow' | 'mfa_required' | 'step_up' | 'deny';

export interface RiskAssessment {
  score: number;
  signals: RiskSignal[];
  action: RiskAction;
  isNewDevice: boolean;
  isNewCountry: boolean;
  impossibleTravelKmh: number | null;
  country: string | null;
  asn: string | null;
}

export interface AssessLoginRiskInput {
  userId?: string;
  tenantId: string;
  clientId?: string;
  ip: string;
  userAgent: string;
  deviceFingerprint: string;
}

const RECENT_FAIL_WINDOW_MS = 60 * 60 * 1000; // 1h
const RECENT_FAIL_THRESHOLD = 3;
const IMPOSSIBLE_TRAVEL_KMH = 900;

// Default rule weights per §3.1 of the implementation plan. Not configurable per-tenant yet —
// only the score→action mapping (risk_policies) is; revisit if a customer needs weight tuning.
const WEIGHTS = {
  newCountry: 30,
  newDevice: 20,
  impossibleTravel: 50,
  newAsn: 15,
  unusualHour: 10,
  recentFailures: 25,
} as const;

function parseJsonArray(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

function uaFamily(userAgent: string): string {
  const ua = userAgent.toLowerCase();
  if (ua.includes('edg/')) return 'Edge';
  if (ua.includes('chrome/')) return 'Chrome';
  if (ua.includes('firefox/')) return 'Firefox';
  if (ua.includes('safari/') && !ua.includes('chrome')) return 'Safari';
  if (ua.includes('curl') || ua.includes('postman')) return 'API-Client';
  return 'Other';
}

function osFamily(userAgent: string): string {
  const ua = userAgent.toLowerCase();
  if (ua.includes('windows')) return 'Windows';
  if (ua.includes('mac os')) return 'macOS';
  if (ua.includes('android')) return 'Android';
  if (ua.includes('iphone') || ua.includes('ipad')) return 'iOS';
  if (ua.includes('linux')) return 'Linux';
  return 'Other';
}

/**
 * Rule-based login risk scoring (implementation plan §3.1 v1 — "先规则，后模型"). Runs on
 * every login attempt behind RISK_ENGINE_MODE; 'off' short-circuits without touching the DB
 * so this is a no-op cost until an operator opts in.
 */
export async function assessLoginRisk(input: AssessLoginRiskInput): Promise<RiskAssessment> {
  const signals: RiskSignal[] = [];
  let isNewDevice = false;
  let isNewCountry = false;
  let impossibleTravelKmh: number | null = null;

  if (getValue('riskEngine') === 'off') {
    return { score: 0, signals, action: 'allow', isNewDevice, isNewCountry, impossibleTravelKmh, country: null, asn: null };
  }

  const geo = await lookupGeo(input.ip);

  let baseline: typeof userBehaviorBaselines.$inferSelect | undefined;
  if (input.userId) {
    [baseline] = await db.select().from(userBehaviorBaselines).where(eq(userBehaviorBaselines.userId, input.userId)).limit(1);
  }

  const usualCountries = parseJsonArray(baseline?.usualCountries);
  const usualAsns = parseJsonArray(baseline?.usualAsns);
  const usualDevices = parseJsonArray(baseline?.usualDevices);
  const usualHours = parseJsonArray(baseline?.usualHours).map(Number);
  const hasBaseline = (baseline?.loginCount ?? 0) > 0;

  // New country
  if (hasBaseline && geo.country && !usualCountries.includes(geo.country)) {
    isNewCountry = true;
    signals.push({ code: 'new_country', weight: WEIGHTS.newCountry, detail: geo.country });
  }

  // New device
  if (hasBaseline && !usualDevices.includes(input.deviceFingerprint)) {
    isNewDevice = true;
    signals.push({ code: 'new_device', weight: WEIGHTS.newDevice });
  }

  // New ASN
  if (hasBaseline && geo.asn && !usualAsns.includes(geo.asn)) {
    signals.push({ code: 'new_asn', weight: WEIGHTS.newAsn, detail: geo.asn });
  }

  // Unusual hour-of-day (only meaningful once a baseline has accumulated enough logins)
  const hourOfDay = new Date().getUTCHours();
  if (hasBaseline && (baseline?.loginCount ?? 0) >= 10 && usualHours.length > 0 && !usualHours.includes(hourOfDay)) {
    signals.push({ code: 'unusual_hour', weight: WEIGHTS.unusualHour, detail: String(hourOfDay) });
  }

  // Impossible travel: compare against the user's most recent successful login event.
  if (input.userId && geo.lat != null && geo.lon != null) {
    const [lastEvent] = await db
      .select({ createdAt: loginEvents.createdAt, ip: loginEvents.ip, country: loginEvents.country })
      .from(loginEvents)
      .where(and(eq(loginEvents.userId, input.userId), eq(loginEvents.outcome, 'success')))
      .orderBy(desc(loginEvents.createdAt))
      .limit(1);

    if (lastEvent?.ip && lastEvent.createdAt) {
      const prevGeo = await lookupGeo(lastEvent.ip);
      if (prevGeo.lat != null && prevGeo.lon != null) {
        const hours = Math.max((Date.now() - new Date(lastEvent.createdAt).getTime()) / 3_600_000, 1 / 60);
        const km = haversineKm(prevGeo.lat, prevGeo.lon, geo.lat, geo.lon);
        const kmh = Math.round(km / hours);
        if (kmh > IMPOSSIBLE_TRAVEL_KMH) {
          impossibleTravelKmh = kmh;
          signals.push({ code: 'impossible_travel', weight: WEIGHTS.impossibleTravel, detail: `${kmh}km/h` });
        }
      }
    }
  }

  // Recent failures (any outcome != success in the last hour for this user)
  if (input.userId) {
    const since = new Date(Date.now() - RECENT_FAIL_WINDOW_MS);
    const [{ count }] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(loginEvents)
      .where(and(eq(loginEvents.userId, input.userId), eq(loginEvents.outcome, 'fail'), gte(loginEvents.createdAt, since)));
    if (count >= RECENT_FAIL_THRESHOLD) {
      signals.push({ code: 'recent_failures', weight: WEIGHTS.recentFailures, detail: String(count) });
    }
  }

  const score = signals.reduce((sum, s) => sum + s.weight, 0);
  const action = await resolveAction(input.tenantId, score);

  riskScoreHistogram.observe({ tenant_id: input.tenantId }, score);
  riskAssessments.inc({ action, mode: getValue('riskEngine'), tenant_id: input.tenantId });

  // Emit risk scored event for real-time consumers
  eventBus.emit({
    id: crypto.randomUUID(),
    type: 'risk.scored',
    tenantId: input.tenantId,
    userId: input.userId,
    timestamp: new Date(),
    payload: { score, action, signals: signals.map(s => s.code), isNewDevice, isNewCountry },
    metadata: { ip: input.ip, userAgent: input.userAgent },
  }).catch((err: any) => logger.warn(`EventBus emit risk.scored failed: ${err.message}`));

  return { score, signals, action, isNewDevice, isNewCountry, impossibleTravelKmh, country: geo.country, asn: geo.asn };
}

const DEFAULT_POLICY_BANDS: { minScore: number; maxScore: number; action: RiskAction }[] = [
  { minScore: 0, maxScore: 29, action: 'allow' },
  { minScore: 30, maxScore: 59, action: 'mfa_required' },
  { minScore: 60, maxScore: 89, action: 'step_up' },
  { minScore: 90, maxScore: 1000, action: 'deny' },
];

// Ordered least -> most restrictive. Used to pick the strictest matching band when an
// admin's risk_policies rows overlap (e.g. a broad 'allow' band and a narrow 'deny' band
// both covering score=95) — silently picking whichever row postgres happens to return first
// (no ORDER BY on the query = undefined order) would make deny-worthy logins non-
// deterministically pass, which is not a bug we want live in a security control.
const ACTION_RESTRICTIVENESS: Record<RiskAction, number> = { allow: 0, mfa_required: 1, step_up: 2, deny: 3 };

async function resolveAction(tenantId: string, score: number): Promise<RiskAction> {
  const policies = await db
    .select()
    .from(riskPolicies)
    .where(and(eq(riskPolicies.tenantId, tenantId), eq(riskPolicies.enabled, true)));

  const bands = policies.length > 0 ? policies : DEFAULT_POLICY_BANDS;
  const matches = bands.filter((p) => score >= p.minScore && score <= p.maxScore);
  if (matches.length === 0) return 'allow';

  return matches.reduce<RiskAction>((strictest, p) => {
    const action = p.action as RiskAction;
    return ACTION_RESTRICTIVENESS[action] > ACTION_RESTRICTIVENESS[strictest] ? action : strictest;
  }, 'allow');
}

export interface RecordLoginEventInput {
  userId?: string | null;
  tenantId: string;
  clientId?: string | null;
  outcome: 'success' | 'fail' | 'blocked' | 'challenged';
  ip: string;
  userAgent: string;
  deviceFingerprint?: string | null;
  authMethods?: string[];
  assessment?: RiskAssessment;
}

export async function recordLoginEvent(input: RecordLoginEventInput): Promise<void> {
  if (getValue('riskEngine') === 'off') return;

  const now = new Date();
  await db.insert(loginEvents).values({
    id: crypto.randomUUID(),
    userId: input.userId || null,
    tenantId: input.tenantId,
    clientId: input.clientId || null,
    outcome: input.outcome,
    ip: input.ip,
    asn: input.assessment?.asn || null,
    country: input.assessment?.country || null,
    city: null,
    uaFamily: uaFamily(input.userAgent),
    osFamily: osFamily(input.userAgent),
    deviceFingerprint: input.deviceFingerprint || null,
    isNewDevice: input.assessment?.isNewDevice ?? null,
    isNewCountry: input.assessment?.isNewCountry ?? null,
    impossibleTravelKmh: input.assessment?.impossibleTravelKmh ?? null,
    hourOfDay: now.getUTCHours(),
    dayOfWeek: now.getUTCDay(),
    authMethods: input.authMethods?.join(',') || null,
    riskScore: input.assessment?.score ?? null,
    riskReasons: input.assessment ? JSON.stringify(input.assessment.signals) : null,
    riskAction: input.assessment?.action ?? null,
  });

  if (input.outcome === 'success' && input.userId) {
    await updateBaseline(input.userId, input.tenantId, {
      country: input.assessment?.country || null,
      asn: input.assessment?.asn || null,
      deviceFingerprint: input.deviceFingerprint || null,
      hourOfDay: now.getUTCHours(),
    }).catch((err) => logger.warn(`updateBaseline failed for ${input.userId}: ${err.message}`));
  }
}

const BASELINE_LIST_CAP = 20;

/**
 * Incrementally folds one successful login into the user's rolling baseline. This is the
 * cheap, always-on counterpart to server/jobs/ueba.job.ts, which does a full nightly
 * recompute — this keeps the "usual X" sets from going stale between batch runs.
 */
export async function updateBaseline(
  userId: string,
  tenantId: string,
  signal: { country: string | null; asn: string | null; deviceFingerprint: string | null; hourOfDay: number }
): Promise<void> {
  const [existing] = await db.select().from(userBehaviorBaselines).where(eq(userBehaviorBaselines.userId, userId)).limit(1);

  const mergeCapped = (raw: string | null | undefined, value: string | null) => {
    const list = parseJsonArray(raw);
    if (!value || list.includes(value)) return JSON.stringify(list);
    const next = [...list, value].slice(-BASELINE_LIST_CAP);
    return JSON.stringify(next);
  };

  const usualHours = parseJsonArray(existing?.usualHours).map(Number);
  const nextHours = usualHours.includes(signal.hourOfDay) ? usualHours : [...usualHours, signal.hourOfDay];

  const values = {
    userId,
    tenantId,
    usualCountries: mergeCapped(existing?.usualCountries, signal.country),
    usualAsns: mergeCapped(existing?.usualAsns, signal.asn),
    usualDevices: mergeCapped(existing?.usualDevices, signal.deviceFingerprint),
    usualHours: JSON.stringify(nextHours),
    loginCount: (existing?.loginCount ?? 0) + 1,
    updatedAt: new Date(),
  };

  if (existing) {
    await db.update(userBehaviorBaselines).set(values).where(eq(userBehaviorBaselines.userId, userId));
  } else {
    await db.insert(userBehaviorBaselines).values(values).onConflictDoUpdate({
      target: userBehaviorBaselines.userId,
      set: values,
    });
  }
}
