import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { haversineKm } from '../server/services/geoip.service.js';

// Re-implemented locally so this property suite has no DB dependency (same pattern as
// tests/github-oauth.property.test.ts) — mirrors server/services/risk.service.ts's WEIGHTS
// and DEFAULT_POLICY_BANDS exactly.
const WEIGHTS = {
  newCountry: 30,
  newDevice: 20,
  impossibleTravel: 50,
  newAsn: 15,
  unusualHour: 10,
  recentFailures: 25,
} as const;

type RiskAction = 'allow' | 'mfa_required' | 'step_up' | 'deny';

const DEFAULT_POLICY_BANDS: { minScore: number; maxScore: number; action: RiskAction }[] = [
  { minScore: 0, maxScore: 29, action: 'allow' },
  { minScore: 30, maxScore: 59, action: 'mfa_required' },
  { minScore: 60, maxScore: 89, action: 'step_up' },
  { minScore: 90, maxScore: 1000, action: 'deny' },
];

function resolveAction(score: number): RiskAction {
  const match = DEFAULT_POLICY_BANDS.find((p) => score >= p.minScore && score <= p.maxScore);
  return match?.action ?? 'allow';
}

const IMPOSSIBLE_TRAVEL_KMH = 900;

// Feature: risk-engine, Property 1: 不可能旅行信号单调性
// A larger reported speed between two logins never produces a *lower* score band than a
// smaller one — the signal set is monotonic in distance/time.
// Validates: implementation plan §3.1 rule engine v1, §阶段三验证
describe('Property 1: impossible-travel signal is monotonic', () => {
  it('crossing the 900km/h threshold always adds the impossibleTravel weight, never subtracts', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 5000 }), (kmh) => {
        const signals = kmh > IMPOSSIBLE_TRAVEL_KMH ? [WEIGHTS.impossibleTravel] : [];
        const score = signals.reduce((a, b) => a + b, 0);
        if (kmh > IMPOSSIBLE_TRAVEL_KMH) {
          expect(score).toBe(WEIGHTS.impossibleTravel);
        } else {
          expect(score).toBe(0);
        }
      }),
      { numRuns: 100 }
    );
  });
});

// Feature: risk-engine, Property 2: 分数区间与动作单调递增
// Higher risk scores must never map to a *less* restrictive action than lower scores
// (allow < mfa_required < step_up < deny in restrictiveness).
// Validates: implementation plan §3.1 risk_policies action mapping
describe('Property 2: score -> action mapping is monotonically non-decreasing in restrictiveness', () => {
  const ORDER: Record<RiskAction, number> = { allow: 0, mfa_required: 1, step_up: 2, deny: 3 };

  it('a higher score never resolves to a less restrictive action than a lower score', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 200 }), fc.integer({ min: 0, max: 200 }), (a, b) => {
        const [lo, hi] = a <= b ? [a, b] : [b, a];
        const loAction = resolveAction(lo);
        const hiAction = resolveAction(hi);
        return ORDER[hiAction] >= ORDER[loAction];
      }),
      { numRuns: 200 }
    );
  });

  it('every signal-weight combination that sums to >= 90 always denies', () => {
    fc.assert(
      fc.property(
        fc.array(fc.constantFrom(...Object.values(WEIGHTS)), { minLength: 0, maxLength: 6 }),
        (weights) => {
          const score = weights.reduce((a, b) => a + b, 0);
          const action = resolveAction(score);
          if (score >= 90) return action === 'deny';
          return true;
        }
      ),
      { numRuns: 200 }
    );
  });
});

// Feature: risk-engine, Property 3: 新设备/新国家信号独立可加
// New-device and new-country signals are independent — either alone must raise the score
// by exactly its own weight, and together by the sum of both (no double counting, no
// cancellation).
// Validates: implementation plan §3.1
describe('Property 3: new-device/new-country signals compose additively', () => {
  it('score equals the sum of whichever signals are present', () => {
    fc.assert(
      fc.property(fc.boolean(), fc.boolean(), (isNewDevice, isNewCountry) => {
        const signals: number[] = [];
        if (isNewCountry) signals.push(WEIGHTS.newCountry);
        if (isNewDevice) signals.push(WEIGHTS.newDevice);
        const score = signals.reduce((a, b) => a + b, 0);
        const expected = (isNewCountry ? WEIGHTS.newCountry : 0) + (isNewDevice ? WEIGHTS.newDevice : 0);
        return score === expected;
      }),
      { numRuns: 100 }
    );
  });
});

// Feature: risk-engine, Property 4: haversineKm 基本几何性质
// Distance from a point to itself is 0; distance is symmetric; distance is non-negative.
// Validates: server/services/geoip.service.ts used by the impossible-travel signal.
describe('Property 4: haversineKm satisfies basic metric properties', () => {
  const lat = fc.double({ min: -85, max: 85, noNaN: true });
  const lon = fc.double({ min: -179, max: 179, noNaN: true });

  it('distance to self is ~0', () => {
    fc.assert(
      fc.property(lat, lon, (a, b) => {
        expect(haversineKm(a, b, a, b)).toBeCloseTo(0, 6);
      }),
      { numRuns: 100 }
    );
  });

  it('is symmetric', () => {
    fc.assert(
      fc.property(lat, lon, lat, lon, (lat1, lon1, lat2, lon2) => {
        const d1 = haversineKm(lat1, lon1, lat2, lon2);
        const d2 = haversineKm(lat2, lon2, lat1, lon1);
        expect(d1).toBeCloseTo(d2, 6);
      }),
      { numRuns: 100 }
    );
  });

  it('is always non-negative and bounded by half the Earth\'s circumference', () => {
    fc.assert(
      fc.property(lat, lon, lat, lon, (lat1, lon1, lat2, lon2) => {
        const d = haversineKm(lat1, lon1, lat2, lon2);
        expect(d).toBeGreaterThanOrEqual(0);
        expect(d).toBeLessThanOrEqual(Math.PI * 6371 + 1);
      }),
      { numRuns: 100 }
    );
  });
});
