import zlib, { deflate } from 'zlib';
import { promisify } from 'util';

const deflateAsync = promisify(deflate);

// Node >=20.15/22.2 exposes zlib.crc32 natively (verified on this project's Node 22 runtime).
// crc32Fallback below only runs on older Node where that export doesn't exist yet.
const nativeCrc32: ((buf: Buffer) => number) | undefined = (zlib as any).crc32;

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function buildChunk(type: string, data: Buffer): Buffer {
  const typeBuf = Buffer.from(type, 'ascii');
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(zlibCrc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([length, typeBuf, data, crc]);
}

function zlibCrc32(buf: Buffer): number {
  if (nativeCrc32) return nativeCrc32(buf) >>> 0;
  return crc32Fallback(buf);
}

let crcTable: Uint32Array | null = null;
function crc32Fallback(buf: Buffer): number {
  if (!crcTable) {
    crcTable = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) {
        c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      }
      crcTable[n] = c;
    }
  }
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    crc = crcTable[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

/**
 * Encodes an RGBA pixel buffer (4 bytes/pixel, row-major, no padding) as a PNG.
 * Always emits 8-bit RGBA (color type 6) with filter type 0 (None) on every
 * scanline — this codebase only ever needs to encode, never decode, so there's
 * no reason to implement the other 4 PNG filter types.
 */
export async function encodePng(rgba: Buffer, width: number, height: number): Promise<Buffer> {
  if (rgba.length !== width * height * 4) {
    throw new Error(`encodePng: buffer length ${rgba.length} does not match ${width}x${height}x4`);
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type: RGBA
  ihdr[10] = 0; // compression method
  ihdr[11] = 0; // filter method
  ihdr[12] = 0; // interlace method

  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    const srcStart = y * stride;
    const dstStart = y * (stride + 1);
    raw[dstStart] = 0; // filter type: None
    rgba.copy(raw, dstStart + 1, srcStart, srcStart + stride);
  }

  const idatData = await deflateAsync(raw, { level: 6 });

  return Buffer.concat([
    PNG_SIGNATURE,
    buildChunk('IHDR', ihdr),
    buildChunk('IDAT', idatData),
    buildChunk('IEND', Buffer.alloc(0)),
  ]);
}

/**
 * Encodes a PNG and returns it as a `data:image/png;base64,...` URI, ready to
 * drop straight into an <img src>.
 */
export async function encodePngDataUri(rgba: Buffer, width: number, height: number): Promise<string> {
  const png = await encodePng(rgba, width, height);
  return `data:image/png;base64,${png.toString('base64')}`;
}
