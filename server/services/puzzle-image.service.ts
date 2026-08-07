/**
 * Procedural slide-puzzle image generation.
 *
 * There are no photo assets in this repo and adding any raises licensing/asset-
 * pipeline questions we don't need — instead both images are generated purely
 * from pixel math (gradient + cheap value noise + a couple of soft blobs), so
 * there's zero PNG *decoding* involved anywhere, only encoding (png-encoder.ts).
 */

// A small curated set of pleasant two-color gradient pairs. Picked for enough
// contrast that the jigsaw notch/border reads clearly against any of them.
const PALETTES: Array<[[number, number, number], [number, number, number]]> = [
  [[76, 29, 149], [219, 39, 119]],
  [[15, 118, 110], [6, 182, 212]],
  [[30, 64, 175], [96, 165, 250]],
  [[120, 53, 15], [217, 119, 6]],
  [[22, 78, 99], [56, 189, 248]],
  [[88, 28, 135], [168, 85, 247]],
  [[6, 78, 59], [52, 211, 153]],
  [[124, 45, 18], [251, 146, 60]],
  [[30, 41, 59], [100, 116, 139]],
  [[131, 24, 67], [244, 63, 94]],
  [[20, 83, 45], [132, 204, 22]],
  [[49, 46, 129], [129, 140, 248]],
  [[113, 63, 18], [250, 204, 21]],
  [[8, 51, 68], [14, 165, 233]],
  [[76, 5, 25], [220, 38, 38]],
];

export interface PuzzleImage {
  bgBuffer: Buffer; // width x height RGBA, background WITH the notch cut in
  pieceBuffer: Buffer; // pieceWidth x pieceHeight RGBA, transparent outside the tab shape
  pieceWidth: number;
  pieceHeight: number;
  pieceX: number; // secret — the answer the client must reproduce
  pieceY: number; // given to the client
}

/** Tiny deterministic PRNG (mulberry32) so a single generation pass is reproducible for tests if ever needed. */
function mulberry32(seed: number): () => number {
  let a = seed;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Cheap 2D value noise: random values on a coarse lattice, bilinearly interpolated. Not Perlin — no gradients, just enough texture to avoid a flat gradient. */
function makeValueNoise(rand: () => number, gridW: number, gridH: number): (x: number, y: number) => number {
  const lattice = new Float32Array(gridW * gridH);
  for (let i = 0; i < lattice.length; i++) lattice[i] = rand();

  return (nx: number, ny: number) => {
    const gx = nx * (gridW - 1);
    const gy = ny * (gridH - 1);
    const x0 = Math.floor(gx);
    const y0 = Math.floor(gy);
    const x1 = Math.min(x0 + 1, gridW - 1);
    const y1 = Math.min(y0 + 1, gridH - 1);
    const fx = gx - x0;
    const fy = gy - y0;
    const v00 = lattice[y0 * gridW + x0];
    const v10 = lattice[y0 * gridW + x1];
    const v01 = lattice[y1 * gridW + x0];
    const v11 = lattice[y1 * gridW + x1];
    const top = v00 + (v10 - v00) * fx;
    const bottom = v01 + (v11 - v01) * fx;
    return top + (bottom - top) * fy;
  };
}

function clamp255(v: number): number {
  return v < 0 ? 0 : v > 255 ? 255 : v | 0;
}

/**
 * A smooth 2-color gradient reads as a flat, empty "solid color" screen — there's
 * nothing for the eye (or the drag motion) to line up against. Real slider
 * captchas use photos specifically because photos have edges and texture. The
 * procedural substitute here layers three cheap effects instead of one:
 *
 *   1. a diagonal gradient at a randomized angle (so it's not always the same axis)
 *   2. a low-poly / Voronoi facet mosaic blended semi-transparently *over* that
 *      gradient — accent-tinted seams read like stained glass or a faceted gem
 *      rather than flat cell borders
 *   3. a handful of soft screen-blended "glow" blobs for highlight variety, plus
 *      a light vignette and fine grain so it doesn't look flat/digital
 *
 * Same idea as a single Voronoi mosaic, just with more visual variety per roll —
 * still a handful of cheap per-pixel math passes, no photographic asset needed.
 */
function generateBackground(width: number, height: number, rand: () => number): Buffer {
  const [c1, c2] = PALETTES[Math.floor(rand() * PALETTES.length)];
  const noise = makeValueNoise(rand, 6, 4);

  // Randomized gradient axis so the base isn't always left-to-right.
  const angle = rand() * Math.PI * 2;
  const ax = Math.cos(angle);
  const ay = Math.sin(angle);
  const diag = Math.abs(ax) * width + Math.abs(ay) * height;
  const originX = ax >= 0 ? 0 : width;
  const originY = ay >= 0 ? 0 : height;

  const seedCount = 14 + Math.floor(rand() * 8); // 14-21 facets
  const seeds = Array.from({ length: seedCount }, () => {
    const t = rand();
    const brightness = 0.8 + rand() * 0.5; // per-cell shade variation
    const warmth = (rand() - 0.5) * 30; // per-cell hue drift
    return {
      x: rand() * width,
      y: rand() * height,
      r: clamp255((c1[0] + (c2[0] - c1[0]) * t) * brightness + warmth),
      g: clamp255((c1[1] + (c2[1] - c1[1]) * t) * brightness + warmth * 0.5),
      b: clamp255((c1[2] + (c2[2] - c1[2]) * t) * brightness - warmth * 0.4),
    };
  });

  // A couple of accent hues for seam lines, drawn from the far end of the
  // palette pair so seams pop against the facets instead of just going dark.
  const seamAccent: [number, number, number] = [
    clamp255((c1[0] + c2[0]) / 2 + 60),
    clamp255((c1[1] + c2[1]) / 2 + 40),
    clamp255((c1[2] + c2[2]) / 2 + 80),
  ];

  // 2-3 soft radial glows, screen-blended on top for highlight variety —
  // brighter, slightly desaturated versions of the palette so they read as light
  // rather than as more flat color.
  const glowCount = 2 + Math.floor(rand() * 2);
  const glows = Array.from({ length: glowCount }, () => ({
    x: rand() * width,
    y: rand() * height,
    radius: (0.25 + rand() * 0.35) * Math.max(width, height),
    r: clamp255(c1[0] * 0.4 + c2[0] * 0.4 + 140),
    g: clamp255(c1[1] * 0.4 + c2[1] * 0.4 + 140),
    b: clamp255(c1[2] * 0.4 + c2[2] * 0.4 + 140),
    strength: 0.12 + rand() * 0.14,
  }));

  const EDGE_BAND = 5; // distance-units gap between nearest/2nd-nearest seed that reads as a seam
  const FACET_MIX = 0.55; // how much the Voronoi facet color shows through over the base gradient
  const cx = width / 2;
  const cy = height / 2;
  const vignetteReach = Math.hypot(cx, cy);

  const buf = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      // 1. base diagonal gradient
      const proj = ((x - originX) * ax + (y - originY) * ay) / diag;
      const gt = Math.max(0, Math.min(1, proj));
      let r = c1[0] + (c2[0] - c1[0]) * gt;
      let g = c1[1] + (c2[1] - c1[1]) * gt;
      let b = c1[2] + (c2[2] - c1[2]) * gt;

      // 2. Voronoi facet mosaic, blended over the gradient with accent seams
      let nearestDistSq = Infinity;
      let secondDistSq = Infinity;
      let nearest = seeds[0];
      for (const s of seeds) {
        const distSq = (x - s.x) ** 2 + (y - s.y) ** 2;
        if (distSq < nearestDistSq) {
          secondDistSq = nearestDistSq;
          nearestDistSq = distSq;
          nearest = s;
        } else if (distSq < secondDistSq) {
          secondDistSq = distSq;
        }
      }
      const seam = Math.sqrt(secondDistSq) - Math.sqrt(nearestDistSq);
      const onSeam = seam < EDGE_BAND;
      const facetR = onSeam ? seamAccent[0] : nearest.r;
      const facetG = onSeam ? seamAccent[1] : nearest.g;
      const facetB = onSeam ? seamAccent[2] : nearest.b;
      const mix = onSeam ? FACET_MIX + 0.25 : FACET_MIX;
      r = r + (facetR - r) * mix;
      g = g + (facetG - g) * mix;
      b = b + (facetB - b) * mix;

      // 3. soft screen-blended glows
      for (const glow of glows) {
        const d = Math.hypot(x - glow.x, y - glow.y) / glow.radius;
        if (d >= 1) continue;
        const falloff = (1 - d) ** 2 * glow.strength;
        r += (glow.r - r) * falloff;
        g += (glow.g - g) * falloff;
        b += (glow.b - b) * falloff;
      }

      // 4. light vignette for depth
      const vig = 1 - 0.16 * (Math.hypot(x - cx, y - cy) / vignetteReach) ** 2;

      // 5. fine grain
      const dither = (noise(x / width, y / height) - 0.5) * 10;

      const i = (y * width + x) * 4;
      buf[i] = clamp255(r * vig + dither);
      buf[i + 1] = clamp255(g * vig + dither);
      buf[i + 2] = clamp255(b * vig + dither);
      buf[i + 3] = 255;
    }
  }
  return buf;
}

/**
 * Coverage (0..1) of the classic jigsaw tab shape at local coordinates (x, y)
 * within a `size` x `maskHeight` bounding box, where maskHeight = size + bumpRadius.
 * One bump centered on the top edge, one dent carved from the bottom edge —
 * fixed shape, only the piece's (X, Y) placement is secret (see module docstring
 * in captcha.service.ts for why shape variety isn't worth the added code).
 */
function tabCoverage(x: number, y: number, size: number, bumpRadius: number): number {
  const SUB = 2; // 2x2 supersampling per pixel is enough at this scale (~44px pieces)
  let hits = 0;
  for (let sy = 0; sy < SUB; sy++) {
    for (let sx = 0; sx < SUB; sx++) {
      const px = x + (sx + 0.5) / SUB;
      const py = y + (sy + 0.5) / SUB;
      const inSquare = px >= 0 && px < size && py >= bumpRadius && py < bumpRadius + size;
      const bumpDist = Math.hypot(px - size / 2, py - bumpRadius);
      const inBump = bumpDist <= bumpRadius;
      const dentDist = Math.hypot(px - size / 2, py - (bumpRadius + size));
      const inDent = dentDist <= bumpRadius * 0.9;
      if ((inSquare || inBump) && !inDent) hits++;
    }
  }
  return hits / (SUB * SUB);
}

export interface PuzzleImageOptions {
  canvasWidth: number;
  canvasHeight: number;
  pieceSize: number;
}

export function generatePuzzleImage(opts: PuzzleImageOptions): PuzzleImage {
  const { canvasWidth, canvasHeight, pieceSize } = opts;
  const rand = mulberry32((Math.random() * 0xffffffff) >>> 0);

  const bumpRadius = Math.round(pieceSize * 0.2);
  const pieceWidth = pieceSize;
  const pieceHeight = pieceSize + bumpRadius;

  const marginX = 20;
  const marginY = 10;
  const minX = marginX + bumpRadius;
  const maxX = canvasWidth - pieceWidth - marginX;
  const minY = marginY;
  const maxY = canvasHeight - pieceHeight - marginY;
  const pieceX = Math.round(minX + rand() * Math.max(0, maxX - minX));
  const pieceY = Math.round(minY + rand() * Math.max(0, maxY - minY));

  const bgBuffer = generateBackground(canvasWidth, canvasHeight, rand);
  const pieceBuffer = Buffer.alloc(pieceWidth * pieceHeight * 4);

  // Darken/border constants for the notch cut into the background, and the
  // complementary highlight border on the extracted piece — both derived from
  // the same tabCoverage() mask so the piece visually matches the hole exactly.
  const NOTCH_DARKEN = 0.45;
  const EDGE_LO = 0.15;
  const EDGE_HI = 0.85;

  for (let y = 0; y < pieceHeight; y++) {
    for (let x = 0; x < pieceWidth; x++) {
      const coverage = tabCoverage(x, y, pieceSize, bumpRadius);
      if (coverage <= 0) continue;

      const bgX = pieceX + x;
      const bgY = pieceY + y;
      const bgIdx = (bgY * canvasWidth + bgX) * 4;
      const isEdge = coverage > EDGE_LO && coverage < EDGE_HI;

      // Copy this pixel into the piece buffer with alpha = coverage.
      const pieceIdx = (y * pieceWidth + x) * 4;
      pieceBuffer[pieceIdx] = bgBuffer[bgIdx];
      pieceBuffer[pieceIdx + 1] = bgBuffer[bgIdx + 1];
      pieceBuffer[pieceIdx + 2] = bgBuffer[bgIdx + 2];
      if (isEdge) {
        // Light rim on the piece so its silhouette reads against any background.
        pieceBuffer[pieceIdx] = clamp255(bgBuffer[bgIdx] + 60);
        pieceBuffer[pieceIdx + 1] = clamp255(bgBuffer[bgIdx + 1] + 60);
        pieceBuffer[pieceIdx + 2] = clamp255(bgBuffer[bgIdx + 2] + 60);
      }
      pieceBuffer[pieceIdx + 3] = clamp255(coverage * 255);

      // Darken (and, on the edge ring, further darken as a border) the same
      // region in the background so the notch is clearly visible.
      const darken = isEdge ? NOTCH_DARKEN + 0.25 : NOTCH_DARKEN;
      bgBuffer[bgIdx] = clamp255(bgBuffer[bgIdx] * (1 - darken * coverage));
      bgBuffer[bgIdx + 1] = clamp255(bgBuffer[bgIdx + 1] * (1 - darken * coverage));
      bgBuffer[bgIdx + 2] = clamp255(bgBuffer[bgIdx + 2] * (1 - darken * coverage));
    }
  }

  return { bgBuffer, pieceBuffer, pieceWidth, pieceHeight, pieceX, pieceY };
}
