/**
 * Pure trajectory/offset scoring for a submitted slide-puzzle solution — no I/O,
 * so it's unit-testable without a cache or a running server.
 *
 * Checks split into two tiers:
 *  - hard gates: fail any one of these and the submission is rejected outright.
 *    These test *where the drag ended up* and *that it didn't teleport* — both
 *    are meaningful regardless of whether the input came from a pointer or a
 *    keyboard.
 *  - soft signals (pointer input only): each contributes to a suspicion score;
 *    only a combination of >=2 rejects. A keyboard user's trail is naturally
 *    y-flat (the mouse never moved) and often has very regular timing (OS key
 *    repeat), which would trip these signals on every legitimate use — so they
 *    are simply not evaluated for input_mode:'keyboard'.
 */

export interface TrailSample {
  x: number;
  y: number;
  t: number; // ms since drag/interaction start
}

export type CaptchaInputMode = 'pointer' | 'keyboard';

export interface EvaluateSolutionInput {
  submittedX: number;
  pieceX: number;
  tolerancePx: number;
  trail: TrailSample[];
  inputMode: CaptchaInputMode;
  travelRangePx: number;
}

export interface EvaluateSolutionResult {
  pass: boolean;
  reason?:
    | 'offset_out_of_tolerance'
    | 'too_few_samples'
    | 'too_fast'
    | 'teleport'
    | 'bot_like_trajectory';
}

function computeR2(trail: TrailSample[]): number {
  const n = trail.length;
  const tMean = trail.reduce((a, s) => a + s.t, 0) / n;
  const xMean = trail.reduce((a, s) => a + s.x, 0) / n;
  let num = 0;
  let denT = 0;
  let denX = 0;
  for (const s of trail) {
    const dt = s.t - tMean;
    const dx = s.x - xMean;
    num += dt * dx;
    denT += dt * dt;
    denX += dx * dx;
  }
  // No time variance or no x variance is itself a degenerate/bot-like trace
  // (e.g. every sample fired at the same instant) — treat as maximally correlated.
  if (denT === 0 || denX === 0) return 1;
  const r = num / Math.sqrt(denT * denX);
  return r * r;
}

export function evaluateSolution(input: EvaluateSolutionInput): EvaluateSolutionResult {
  const { submittedX, pieceX, tolerancePx, trail, inputMode, travelRangePx } = input;

  if (Math.abs(submittedX - pieceX) > tolerancePx) {
    return { pass: false, reason: 'offset_out_of_tolerance' };
  }

  const minSamples = inputMode === 'keyboard' ? 3 : 5;
  if (trail.length < minSamples) {
    return { pass: false, reason: 'too_few_samples' };
  }

  const duration = trail[trail.length - 1].t - trail[0].t;
  const minDuration = inputMode === 'keyboard' ? 300 : 150;
  if (duration < minDuration) {
    return { pass: false, reason: 'too_fast' };
  }

  for (let i = 1; i < trail.length; i++) {
    const dx = Math.abs(trail[i].x - trail[i - 1].x);
    const dt = trail[i].t - trail[i - 1].t;
    if (dx > 0.5 * travelRangePx && dt < 20) {
      return { pass: false, reason: 'teleport' };
    }
  }

  if (inputMode === 'pointer') {
    let suspicionScore = 0;

    const velocities: number[] = [];
    for (let i = 1; i < trail.length; i++) {
      const dt = trail[i].t - trail[i - 1].t;
      if (dt > 0) velocities.push((trail[i].x - trail[i - 1].x) / dt);
    }
    if (velocities.length >= 2) {
      const mean = velocities.reduce((a, b) => a + b, 0) / velocities.length;
      const variance = velocities.reduce((a, b) => a + (b - mean) ** 2, 0) / velocities.length;
      const cv = mean !== 0 ? Math.abs(Math.sqrt(variance) / mean) : Infinity;
      if (cv < 0.15) suspicionScore++;
    }

    const ys = trail.map((s) => s.y);
    const yMean = ys.reduce((a, b) => a + b, 0) / ys.length;
    const yVariance = ys.reduce((a, b) => a + (b - yMean) ** 2, 0) / ys.length;
    if (Math.sqrt(yVariance) < 0.3) suspicionScore++;

    if (computeR2(trail) > 0.999) suspicionScore++;

    if (suspicionScore >= 2) {
      return { pass: false, reason: 'bot_like_trajectory' };
    }
  }

  return { pass: true };
}
