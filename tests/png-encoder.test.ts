import { describe, it, expect } from 'vitest';
import zlib from 'zlib';
import { encodePng, encodePngDataUri } from '../server/services/png-encoder.js';

function makeRgba(w: number, h: number, fill: (x: number, y: number) => [number, number, number, number]): Buffer {
  const buf = Buffer.alloc(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const [r, g, b, a] = fill(x, y);
      const i = (y * w + x) * 4;
      buf[i] = r;
      buf[i + 1] = g;
      buf[i + 2] = b;
      buf[i + 3] = a;
    }
  }
  return buf;
}

/** Minimal PNG reader for this encoder's own output — it always emits filter type 0 (None). */
function decodePng(png: Buffer): { width: number; height: number; pixels: Buffer } {
  let offset = 8;
  let width = 0;
  let height = 0;
  let idat = Buffer.alloc(0);
  while (offset < png.length) {
    const len = png.readUInt32BE(offset);
    const type = png.subarray(offset + 4, offset + 8).toString('ascii');
    const data = png.subarray(offset + 8, offset + 8 + len);
    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
    }
    if (type === 'IDAT') idat = Buffer.concat([idat, data]);
    offset += 8 + len + 4;
  }
  const raw = zlib.inflateSync(idat);
  const stride = width * 4;
  const pixels = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y++) {
    const filterType = raw[y * (stride + 1)];
    if (filterType !== 0) throw new Error(`unexpected filter type ${filterType}`);
    raw.copy(pixels, y * stride, y * (stride + 1) + 1, y * (stride + 1) + 1 + stride);
  }
  return { width, height, pixels };
}

describe('png-encoder', () => {
  it('round-trips pixel data exactly for a small checkerboard', async () => {
    const w = 4;
    const h = 4;
    const rgba = makeRgba(w, h, (x, y) => ((x + y) % 2 === 0 ? [255, 0, 0, 255] : [0, 255, 0, 255]));
    const png = await encodePng(rgba, w, h);

    expect(png.subarray(0, 8)).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));

    const decoded = decodePng(png);
    expect(decoded.width).toBe(w);
    expect(decoded.height).toBe(h);
    expect(decoded.pixels).toEqual(rgba);
  });

  it('round-trips a 1x1 pixel image and matches hand-computed IHDR bytes', async () => {
    const rgba = Buffer.from([12, 34, 56, 255]);
    const png = await encodePng(rgba, 1, 1);

    // IHDR chunk starts right after the 8-byte signature: 4-byte length, 4-byte type, then data.
    const ihdrLength = png.readUInt32BE(8);
    const ihdrType = png.subarray(12, 16).toString('ascii');
    const ihdrData = png.subarray(16, 16 + ihdrLength);

    expect(ihdrLength).toBe(13);
    expect(ihdrType).toBe('IHDR');
    expect(ihdrData.readUInt32BE(0)).toBe(1); // width
    expect(ihdrData.readUInt32BE(4)).toBe(1); // height
    expect(ihdrData[8]).toBe(8); // bit depth
    expect(ihdrData[9]).toBe(6); // color type: RGBA
    expect(ihdrData[10]).toBe(0);
    expect(ihdrData[11]).toBe(0);
    expect(ihdrData[12]).toBe(0);

    const decoded = decodePng(png);
    expect(decoded.pixels).toEqual(rgba);
  });

  it('rejects a buffer whose length does not match width*height*4', async () => {
    await expect(encodePng(Buffer.alloc(10), 4, 4)).rejects.toThrow();
  });

  it('encodePngDataUri returns a data: URI wrapping the same bytes as encodePng', async () => {
    const rgba = makeRgba(2, 2, () => [1, 2, 3, 4]);
    const [png, uri] = await Promise.all([encodePng(rgba, 2, 2), encodePngDataUri(rgba, 2, 2)]);
    expect(uri.startsWith('data:image/png;base64,')).toBe(true);
    const base64 = uri.slice('data:image/png;base64,'.length);
    expect(Buffer.from(base64, 'base64')).toEqual(png);
  });
});
