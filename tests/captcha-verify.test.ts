import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { evaluateSolution } from '../server/services/captcha-verify.js';
import type { TrailSample } from '../server/services/captcha-verify.js';

const TOLERANCE = 6;
const TRAVEL_RANGE = 276; // matches CAPTCHA_CONFIG.canvasWidth - pieceSize (320 - 44)

function humanTrail(targetX: number, samples = 10, msPerStep = 25): TrailSample[] {
  const trail: TrailSample[] = [];
  for (let i = 0; i < samples; i++) {
    const frac = i / (samples - 1);
    const eased = 1 - (1 - frac) ** 2; // non-uniform (ease-out) velocity
    trail.push({ x: Math.round(eased * targetX), y: (i % 2 === 0 ? 1 : -1), t: i * msPerStep });
  }
  trail[trail.length - 1].x = targetX;
  return trail;
}

function baseInput(overrides: Partial<Parameters<typeof evaluateSolution>[0]> = {}) {
  return {
    submittedX: 100,
    pieceX: 100,
    tolerancePx: TOLERANCE,
    trail: humanTrail(100),
    inputMode: 'pointer' as const,
    travelRangePx: TRAVEL_RANGE,
    ...overrides,
  };
}

describe('captcha-verify: offset tolerance', () => {
  it('passes at exactly the tolerance boundary', () => {
    const result = evaluateSolution(baseInput({ submittedX: 106, trail: humanTrail(106) }));
    expect(result.pass).toBe(true);
  });

  it('fails just past the tolerance boundary', () => {
    const result = evaluateSolution(baseInput({ submittedX: 107, trail: humanTrail(107) }));
    expect(result.pass).toBe(false);
    expect(result.reason).toBe('offset_out_of_tolerance');
  });

  it('passes at the negative tolerance boundary', () => {
    const result = evaluateSolution(baseInput({ submittedX: 94, pieceX: 100, trail: humanTrail(94) }));
    expect(result.pass).toBe(true);
  });
});

describe('captcha-verify: hard gates', () => {
  it('rejects too few samples for pointer input', () => {
    const trail: TrailSample[] = [
      { x: 0, y: 0, t: 0 },
      { x: 50, y: 0, t: 100 },
      { x: 100, y: 0, t: 200 },
    ];
    const result = evaluateSolution(baseInput({ trail }));
    expect(result.pass).toBe(false);
    expect(result.reason).toBe('too_few_samples');
  });

  it('accepts fewer samples for keyboard input (min 3)', () => {
    const trail: TrailSample[] = [
      { x: 0, y: 0, t: 0 },
      { x: 50, y: 0, t: 150 },
      { x: 100, y: 0, t: 320 },
    ];
    const result = evaluateSolution(baseInput({ inputMode: 'keyboard', trail }));
    expect(result.pass).toBe(true);
  });

  it('rejects a submission that is too fast (pointer)', () => {
    const trail: TrailSample[] = Array.from({ length: 6 }, (_, i) => ({ x: (i / 5) * 100, y: 0, t: i * 10 }));
    const result = evaluateSolution(baseInput({ trail }));
    expect(result.pass).toBe(false);
    expect(result.reason).toBe('too_fast');
  });

  it('rejects a submission that is too fast (keyboard, higher floor)', () => {
    const trail: TrailSample[] = [
      { x: 0, y: 0, t: 0 },
      { x: 50, y: 0, t: 100 },
      { x: 100, y: 0, t: 200 }, // 200ms < 300ms keyboard floor
    ];
    const result = evaluateSolution(baseInput({ inputMode: 'keyboard', trail }));
    expect(result.pass).toBe(false);
    expect(result.reason).toBe('too_fast');
  });

  it('rejects a teleport: a huge jump in a tiny time window', () => {
    const trail: TrailSample[] = [
      { x: 0, y: 0, t: 0 },
      { x: 10, y: 1, t: 40 },
      { x: 20, y: -1, t: 80 },
      { x: 250, y: 0, t: 95 }, // jumps most of the travel range in 15ms
      { x: 260, y: 0, t: 400 },
      { x: 264, y: 0, t: 500 },
    ];
    const result = evaluateSolution(baseInput({ submittedX: 264, pieceX: 264, trail }));
    expect(result.pass).toBe(false);
    expect(result.reason).toBe('teleport');
  });

  it('property: any trail containing a teleport jump is always rejected regardless of other params', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 276 }),
        fc.integer({ min: 0, max: 276 }),
        fc.constantFrom<'pointer' | 'keyboard'>('pointer', 'keyboard'),
        (targetX, jumpX, inputMode) => {
          const trail: TrailSample[] = [
            { x: 0, y: 0, t: 0 },
            { x: 10, y: 0, t: 50 },
            { x: jumpX, y: 0, t: 55 }, // 5ms later, arbitrary jump — teleport gate fires whenever |dx| > 0.5*range
            { x: targetX, y: 0, t: 500 },
            { x: targetX, y: 0, t: 600 },
          ];
          const result = evaluateSolution({
            submittedX: targetX,
            pieceX: targetX,
            tolerancePx: TOLERANCE,
            trail,
            inputMode,
            travelRangePx: TRAVEL_RANGE,
          });
          const dx = Math.abs(jumpX - 10);
          if (dx > 0.5 * TRAVEL_RANGE) {
            expect(result.pass).toBe(false);
            expect(result.reason).toBe('teleport');
          }
        }
      ),
      { numRuns: 200 }
    );
  });
});

describe('captcha-verify: soft signals (pointer only)', () => {
  it('rejects a perfectly linear, constant-velocity trail (classic bot trace)', () => {
    const trail: TrailSample[] = Array.from({ length: 10 }, (_, i) => ({
      x: Math.round((i / 9) * 100),
      y: 0, // perfectly flat
      t: i * 30, // perfectly even timing
    }));
    const result = evaluateSolution(baseInput({ trail }));
    expect(result.pass).toBe(false);
    expect(result.reason).toBe('bot_like_trajectory');
  });

  it('accepts a human-like trail with jitter and non-uniform (eased) velocity', () => {
    const result = evaluateSolution(baseInput({ trail: humanTrail(100, 14) }));
    expect(result.pass).toBe(true);
  });

  it('does NOT apply soft signals to keyboard input, even though its trail is naturally flat/regular', () => {
    // A real keyboard user's trail is y-flat (mouse never moved) and often evenly timed
    // (OS key repeat) — exactly what the pointer soft signals would flag. This must still pass.
    const trail: TrailSample[] = Array.from({ length: 8 }, (_, i) => ({
      x: Math.round((i / 7) * 100),
      y: 0,
      t: i * 60,
    }));
    const result = evaluateSolution(baseInput({ inputMode: 'keyboard', trail }));
    expect(result.pass).toBe(true);
  });
});
