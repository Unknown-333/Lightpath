// A minimal TrueType reader: enough to turn a few glyphs into outlines.
// Reads cmap (format 4), hmtx, loca and glyf (simple and composite glyphs). No hinting, no GPOS.
// Used to outline the wordmark and the sheet labels, so no SVG or PNG here depends on a font.
import { readFileSync } from 'node:fs';

export function loadFont(path) {
  const buf = readFileSync(path);
  const tables = {};
  const numTables = buf.readUInt16BE(4);
  for (let i = 0; i < numTables; i++) {
    const o = 12 + i * 16;
    tables[buf.toString('ascii', o, o + 4)] = {
      offset: buf.readUInt32BE(o + 8),
      length: buf.readUInt32BE(o + 12),
    };
  }
  for (const t of ['head', 'hhea', 'hmtx', 'maxp', 'cmap', 'loca', 'glyf', 'OS/2']) {
    if (!tables[t]) throw new Error(`${path}: no ${t} table (need a static TrueType font)`);
  }
  const head = tables.head.offset;
  const unitsPerEm = buf.readUInt16BE(head + 18);
  const longLoca = buf.readInt16BE(head + 50) === 1;
  const numGlyphs = buf.readUInt16BE(tables.maxp.offset + 4);
  const numHMetrics = buf.readUInt16BE(tables.hhea.offset + 34);
  const os2 = tables['OS/2'].offset;
  const metrics = {
    unitsPerEm,
    ascender: buf.readInt16BE(tables.hhea.offset + 4),
    descender: buf.readInt16BE(tables.hhea.offset + 6),
    xHeight: buf.readInt16BE(os2 + 86),
    capHeight: buf.readInt16BE(os2 + 88),
  };

  const advance = (gid) => buf.readUInt16BE(tables.hmtx.offset + 4 * Math.min(gid, numHMetrics - 1));
  const locaAt = (gid) =>
    longLoca
      ? buf.readUInt32BE(tables.loca.offset + gid * 4)
      : buf.readUInt16BE(tables.loca.offset + gid * 2) * 2;

  const cmap = readCmap(buf, tables.cmap.offset);

  // Contours as arrays of { x, y, on } points in font units (y up).
  function contours(gid, depth = 0) {
    if (gid >= numGlyphs || depth > 8) return [];
    const start = locaAt(gid);
    const end = locaAt(gid + 1);
    if (end === start) return [];
    const g = tables.glyf.offset + start;
    const n = buf.readInt16BE(g);
    if (n >= 0) return simpleGlyph(buf, g, n);
    return compositeGlyph(buf, g, (id) => contours(id, depth + 1));
  }

  const glyphId = (ch) => {
    const gid = cmap.get(ch.codePointAt(0));
    if (gid === undefined) throw new Error(`${path}: no glyph for ${JSON.stringify(ch)}`);
    return gid;
  };

  return { metrics, advance, contours, glyphId };
}

function readCmap(buf, base) {
  const n = buf.readUInt16BE(base + 2);
  for (let i = 0; i < n; i++) {
    const platform = buf.readUInt16BE(base + 4 + i * 8);
    const encoding = buf.readUInt16BE(base + 6 + i * 8);
    const off = base + buf.readUInt32BE(base + 8 + i * 8);
    if (platform === 3 && encoding === 1 && buf.readUInt16BE(off) === 4) return cmapFormat4(buf, off);
  }
  throw new Error('no Windows Unicode BMP cmap (format 4)');
}

function cmapFormat4(buf, off) {
  const map = new Map();
  const segX2 = buf.readUInt16BE(off + 6);
  const ends = off + 14;
  const starts = ends + segX2 + 2;
  const deltas = starts + segX2;
  const ranges = deltas + segX2;
  for (let s = 0; s < segX2 / 2; s++) {
    const endC = buf.readUInt16BE(ends + s * 2);
    const startC = buf.readUInt16BE(starts + s * 2);
    const delta = buf.readInt16BE(deltas + s * 2);
    const rangeOff = buf.readUInt16BE(ranges + s * 2);
    for (let c = startC; c <= endC && c !== 0xffff; c++) {
      let gid;
      if (rangeOff === 0) gid = (c + delta) & 0xffff;
      else {
        const p = ranges + s * 2 + rangeOff + (c - startC) * 2;
        gid = buf.readUInt16BE(p);
        if (gid !== 0) gid = (gid + delta) & 0xffff;
      }
      if (gid !== 0) map.set(c, gid);
    }
  }
  return map;
}

function simpleGlyph(buf, g, n) {
  const endPts = [];
  for (let i = 0; i < n; i++) endPts.push(buf.readUInt16BE(g + 10 + i * 2));
  const count = n ? endPts[n - 1] + 1 : 0;
  let p = g + 10 + n * 2;
  p += 2 + buf.readUInt16BE(p); // skip instructions
  const flags = [];
  while (flags.length < count) {
    const f = buf[p++];
    flags.push(f);
    if (f & 8) {
      let r = buf[p++];
      while (r-- > 0) flags.push(f);
    }
  }
  const read = (shortBit, sameBit) => {
    const out = [];
    let v = 0;
    for (const f of flags) {
      if (f & shortBit) {
        const d = buf[p++];
        v += f & sameBit ? d : -d;
      } else if (!(f & sameBit)) {
        v += buf.readInt16BE(p);
        p += 2;
      }
      out.push(v);
    }
    return out;
  };
  const xs = read(2, 16);
  const ys = read(4, 32);
  const result = [];
  let s = 0;
  for (const e of endPts) {
    const c = [];
    for (let i = s; i <= e; i++) c.push({ x: xs[i], y: ys[i], on: (flags[i] & 1) === 1 });
    result.push(c);
    s = e + 1;
  }
  return result;
}

function compositeGlyph(buf, g, sub) {
  const out = [];
  let p = g + 10;
  let more = true;
  while (more) {
    const flags = buf.readUInt16BE(p);
    const gid = buf.readUInt16BE(p + 2);
    p += 4;
    let dx;
    let dy;
    if (flags & 1) {
      dx = buf.readInt16BE(p);
      dy = buf.readInt16BE(p + 2);
      p += 4;
    } else {
      dx = buf.readInt8(p);
      dy = buf.readInt8(p + 1);
      p += 2;
    }
    if (!(flags & 2)) throw new Error('composite glyph with point-matched offsets is not supported');
    let [a, b, c, d] = [1, 0, 0, 1];
    const f2 = (o) => buf.readInt16BE(o) / 16384;
    if (flags & 8) {
      a = d = f2(p);
      p += 2;
    } else if (flags & 0x40) {
      a = f2(p);
      d = f2(p + 2);
      p += 4;
    } else if (flags & 0x80) {
      a = f2(p);
      b = f2(p + 2);
      c = f2(p + 4);
      d = f2(p + 6);
      p += 8;
    }
    for (const contour of sub(gid)) {
      out.push(
        contour.map((pt) => ({ x: a * pt.x + c * pt.y + dx, y: b * pt.x + d * pt.y + dy, on: pt.on })),
      );
    }
    more = (flags & 0x20) !== 0;
  }
  return out;
}

/**
 * One contour of TrueType points to path segments: M, L and Q, closed.
 * Two off-curve points in a row imply an on-curve point halfway between them.
 */
export function contourToSegments(points) {
  const n = points.length;
  if (n === 0) return [];
  const mid = (a, b) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
  let start;
  let seq;
  if (points[0].on) {
    start = points[0];
    seq = points.slice(1);
  } else if (points[n - 1].on) {
    start = points[n - 1];
    seq = points.slice(0, n - 1);
  } else {
    start = mid(points[0], points[n - 1]);
    seq = points.slice();
  }
  const segs = [{ c: 'M', x: start.x, y: start.y }];
  const q = (c, to) => segs.push({ c: 'Q', cx: c.x, cy: c.y, x: to.x, y: to.y });
  let ctrl = null;
  for (const pt of seq) {
    if (pt.on) {
      if (ctrl) q(ctrl, pt);
      else segs.push({ c: 'L', x: pt.x, y: pt.y });
      ctrl = null;
    } else {
      if (ctrl) q(ctrl, mid(ctrl, pt));
      ctrl = pt;
    }
  }
  if (ctrl) q(ctrl, start);
  else segs.push({ c: 'L', x: start.x, y: start.y });
  segs.push({ c: 'Z' });
  return segs;
}
