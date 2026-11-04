// A small animated-GIF writer. One global colour table (the palette, padded to 16),
// no local tables, so the GIF can only show palette colours. Each frame after the first
// stores only the rectangle that changed, drawn over the last frame (disposal 1).

function lzw(indices, minCode) {
  const clear = 1 << minCode;
  const eoi = clear + 1;
  const out = [];
  let bitBuf = 0;
  let bitLen = 0;
  let size = minCode + 1;
  const emit = (code) => {
    bitBuf |= code << bitLen;
    bitLen += size;
    while (bitLen >= 8) {
      out.push(bitBuf & 0xff);
      bitBuf >>>= 8;
      bitLen -= 8;
    }
  };
  let dict = new Map();
  let next = eoi + 1;
  emit(clear);
  let prefix = indices[0];
  for (let i = 1; i < indices.length; i++) {
    const k = indices[i];
    const key = prefix * 4096 + k;
    const hit = dict.get(key);
    if (hit !== undefined) {
      prefix = hit;
      continue;
    }
    emit(prefix);
    if (next < 4096) {
      dict.set(key, next++);
      if (next > 1 << size && size < 12) size++;
    } else {
      emit(clear);
      dict = new Map();
      next = eoi + 1;
      size = minCode + 1;
    }
    prefix = k;
  }
  emit(prefix);
  emit(eoi);
  if (bitLen > 0) out.push(bitBuf & 0xff);
  return Buffer.from(out);
}

function subBlocks(data) {
  const parts = [];
  for (let i = 0; i < data.length; i += 255) {
    const n = Math.min(255, data.length - i);
    parts.push(Buffer.from([n]), data.subarray(i, i + n));
  }
  parts.push(Buffer.from([0]));
  return Buffer.concat(parts);
}

const u16 = (v) => Buffer.from([v & 0xff, (v >> 8) & 0xff]);

/** frames: Raster[] of equal size; delayCs: delay per frame in 1/100 s. */
export function encodeGIF(frames, rgb, delayCs) {
  const { w, h } = frames[0];
  // Unused slots repeat palette entry 0, so every table entry is a palette colour.
  const table = Buffer.from(Array.from({ length: 16 }, (_, i) => rgb[i] ?? rgb[0]).flat());
  const parts = [
    Buffer.from('GIF89a', 'ascii'),
    u16(w),
    u16(h),
    Buffer.from([0xf0 | 0x03, 0, 0]), // global table, 8-bit colour resolution, 2^(3+1) = 16 entries
    table,
    Buffer.from([0x21, 0xff, 0x0b]),
    Buffer.from('NETSCAPE2.0', 'ascii'),
    Buffer.from([3, 1, 0, 0, 0]), // loop forever
  ];
  let prev = null;
  for (const f of frames) {
    let x0 = 0;
    let y0 = 0;
    let x1 = w - 1;
    let y1 = h - 1;
    if (prev) {
      x0 = w;
      y0 = h;
      x1 = -1;
      y1 = -1;
      for (let y = 0; y < h; y++)
        for (let x = 0; x < w; x++)
          if (f.px[y * w + x] !== prev.px[y * w + x]) {
            if (x < x0) x0 = x;
            if (x > x1) x1 = x;
            if (y < y0) y0 = y;
            if (y > y1) y1 = y;
          }
      if (x1 < 0) {
        x0 = 0;
        y0 = 0;
        x1 = 0;
        y1 = 0;
      }
    }
    const fw = x1 - x0 + 1;
    const fh = y1 - y0 + 1;
    const idx = new Uint8Array(fw * fh);
    for (let y = 0; y < fh; y++) idx.set(f.px.subarray((y0 + y) * w + x0, (y0 + y) * w + x0 + fw), y * fw);
    parts.push(Buffer.from([0x21, 0xf9, 4, 0x04]), u16(delayCs), Buffer.from([0, 0]));
    parts.push(Buffer.from([0x2c]), u16(x0), u16(y0), u16(fw), u16(fh), Buffer.from([0]));
    parts.push(Buffer.from([4]), subBlocks(lzw(idx, 4)));
    prev = f;
  }
  parts.push(Buffer.from([0x3b]));
  return Buffer.concat(parts);
}

/** Read the global colour table and check there are no local tables. */
export function gifColours(buf) {
  const packed = buf[10];
  const n = 2 << (packed & 7);
  const table = [];
  for (let i = 0; i < n; i++) table.push([buf[13 + i * 3], buf[14 + i * 3], buf[15 + i * 3]]);
  let off = 13 + n * 3;
  let frames = 0;
  let localTables = 0;
  const used = new Set();
  while (off < buf.length) {
    const b = buf[off];
    if (b === 0x3b) break;
    if (b === 0x21) {
      off += 2;
      while (buf[off] !== 0) off += buf[off] + 1;
      off += 1;
    } else if (b === 0x2c) {
      frames++;
      const p = buf[off + 9];
      if (p & 0x80) localTables++;
      off += 10;
      off += 1; // LZW minimum code size
      while (buf[off] !== 0) off += buf[off] + 1;
      off += 1;
    } else throw new Error(`bad GIF block 0x${b.toString(16)} at ${off}`);
  }
  for (const t of table) used.add(t.join(','));
  return { table, frames, localTables };
}
