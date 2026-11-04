// A small PNG writer and reader (Node's zlib only).
// Brand images are written as indexed PNGs (colour type 3) whose PLTE holds exactly the palette,
// so a viewer can only ever show palette colours. The reader exists for the colour check.
import { deflateSync, inflateSync } from 'node:zlib';

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}

const SIG = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

function ihdr(w, h, colourType) {
  const b = Buffer.alloc(13);
  b.writeUInt32BE(w, 0);
  b.writeUInt32BE(h, 4);
  b[8] = 8;
  b[9] = colourType;
  return b;
}

/** Indexed PNG from a Raster and the palette's RGB triples. */
export function encodeIndexed(r, rgb) {
  const raw = Buffer.alloc((r.w + 1) * r.h);
  for (let y = 0; y < r.h; y++) {
    raw[y * (r.w + 1)] = 0;
    raw.set(r.px.subarray(y * r.w, (y + 1) * r.w), y * (r.w + 1) + 1);
  }
  return Buffer.concat([
    SIG,
    chunk('IHDR', ihdr(r.w, r.h, 3)),
    chunk('PLTE', Buffer.from(rgb.flat())),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/** Truecolour PNG from an RGB byte buffer (used only for review sheets). */
export function encodeRGB(w, h, rgbBytes) {
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 3 + 1)] = 0;
    raw.set(rgbBytes.subarray(y * w * 3, (y + 1) * w * 3), y * (w * 3 + 1) + 1);
  }
  return Buffer.concat([
    SIG,
    chunk('IHDR', ihdr(w, h, 2)),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/** Decode an 8-bit PNG (colour types 2, 3, 6) to { w, h, rgb } with rgb as a flat RGB buffer. */
export function decodePNG(buf) {
  if (!buf.subarray(0, 8).equals(SIG)) throw new Error('not a PNG');
  let off = 8;
  let w = 0;
  let h = 0;
  let type = 0;
  let plte = null;
  const idat = [];
  while (off < buf.length) {
    const len = buf.readUInt32BE(off);
    const t = buf.toString('ascii', off + 4, off + 8);
    const data = buf.subarray(off + 8, off + 8 + len);
    if (t === 'IHDR') {
      w = data.readUInt32BE(0);
      h = data.readUInt32BE(4);
      if (data[8] !== 8 || data[12] !== 0) throw new Error('only 8-bit, non-interlaced PNGs');
      type = data[9];
    } else if (t === 'PLTE') plte = data;
    else if (t === 'IDAT') idat.push(data);
    off += 12 + len;
  }
  const bpp = { 2: 3, 3: 1, 6: 4 }[type];
  if (!bpp) throw new Error(`PNG colour type ${type} not supported`);
  const raw = inflateSync(Buffer.concat(idat));
  const stride = w * bpp;
  const cur = Buffer.alloc(stride);
  const prev = Buffer.alloc(stride);
  const rgb = Buffer.alloc(w * h * 3);
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)];
    const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    for (let i = 0; i < stride; i++) {
      const a = i >= bpp ? cur[i - bpp] : 0;
      const b = prev[i];
      const c = i >= bpp ? prev[i - bpp] : 0;
      let v = line[i];
      if (f === 1) v += a;
      else if (f === 2) v += b;
      else if (f === 3) v += (a + b) >> 1;
      else if (f === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a);
        const pb = Math.abs(p - b);
        const pc = Math.abs(p - c);
        v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      cur[i] = v & 0xff;
    }
    for (let x = 0; x < w; x++) {
      const o = (y * w + x) * 3;
      if (type === 3) {
        const k = cur[x] * 3;
        rgb[o] = plte[k];
        rgb[o + 1] = plte[k + 1];
        rgb[o + 2] = plte[k + 2];
      } else {
        rgb[o] = cur[x * bpp];
        rgb[o + 1] = cur[x * bpp + 1];
        rgb[o + 2] = cur[x * bpp + 2];
      }
    }
    prev.set(cur);
  }
  return { w, h, rgb };
}
