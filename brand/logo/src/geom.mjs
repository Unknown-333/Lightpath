// Shape model for the logo. Every shape is a filled outline (no SVG strokes), so the SVG files and the
// PNG files are drawn from the same geometry. Segments, in design units, y down:
//   { c: 'M', x, y }  { c: 'L', x, y }  { c: 'Q', cx, cy, x, y }  { c: 'Z' }
//   { c: 'A', cx, cy, r, a0, a1 }   circular arc around (cx, cy) from angle a0 to a1 (radians, y down,
//                                    so a growing angle turns clockwise on screen). It starts at the pen.
const TAU = Math.PI * 2;
const pt = (cx, cy, r, a) => [cx + r * Math.cos(a), cy + r * Math.sin(a)];

export function rect(x, y, w, h) {
  return [
    { c: 'M', x, y },
    { c: 'L', x: x + w, y },
    { c: 'L', x: x + w, y: y + h },
    { c: 'L', x, y: y + h },
    { c: 'Z' },
  ];
}

export function roundRect(x, y, w, h, r) {
  const q = Math.PI / 2;
  return [
    { c: 'M', x: x + r, y },
    { c: 'L', x: x + w - r, y },
    { c: 'A', cx: x + w - r, cy: y + r, r, a0: -q, a1: 0 },
    { c: 'L', x: x + w, y: y + h - r },
    { c: 'A', cx: x + w - r, cy: y + h - r, r, a0: 0, a1: q },
    { c: 'L', x: x + r, y: y + h },
    { c: 'A', cx: x + r, cy: y + h - r, r, a0: q, a1: 2 * q },
    { c: 'L', x, y: y + r },
    { c: 'A', cx: x + r, cy: y + r, r, a0: 2 * q, a1: 3 * q },
    { c: 'Z' },
  ];
}

export function circle(cx, cy, r) {
  return [{ c: 'M', x: cx + r, y: cy }, { c: 'A', cx, cy, r, a0: 0, a1: TAU }, { c: 'Z' }];
}

/** A band between two concentric arcs (the bend of a stroke). Angles in degrees. */
export function bend(cx, cy, rOut, rIn, deg0, deg1) {
  // Always wind clockwise on screen, like rect and circle, so pieces of one colour can share one
  // nonzero-filled path without cancelling where they overlap.
  const a0 = (Math.min(deg0, deg1) * Math.PI) / 180;
  const a1 = (Math.max(deg0, deg1) * Math.PI) / 180;
  const [sx, sy] = pt(cx, cy, rOut, a0);
  const [ix, iy] = pt(cx, cy, rIn, a1);
  return [
    { c: 'M', x: sx, y: sy },
    { c: 'A', cx, cy, r: rOut, a0, a1 },
    { c: 'L', x: ix, y: iy },
    { c: 'A', cx, cy, r: rIn, a0: a1, a1: a0 },
    { c: 'Z' },
  ];
}

/** Uniform scale then translate. */
export function transform(segs, s, dx, dy) {
  return segs.map((g) => {
    switch (g.c) {
      case 'M':
      case 'L':
        return { c: g.c, x: g.x * s + dx, y: g.y * s + dy };
      case 'Q':
        return { c: 'Q', cx: g.cx * s + dx, cy: g.cy * s + dy, x: g.x * s + dx, y: g.y * s + dy };
      case 'A':
        return { c: 'A', cx: g.cx * s + dx, cy: g.cy * s + dy, r: g.r * s, a0: g.a0, a1: g.a1 };
      default:
        return g;
    }
  });
}

export function bounds(segsList) {
  let x0 = Number.POSITIVE_INFINITY;
  let y0 = Number.POSITIVE_INFINITY;
  let x1 = Number.NEGATIVE_INFINITY;
  let y1 = Number.NEGATIVE_INFINITY;
  for (const poly of flatten(segsList.flat(), 1, 0.01)) {
    for (const [x, y] of poly) {
      x0 = Math.min(x0, x);
      y0 = Math.min(y0, y);
      x1 = Math.max(x1, x);
      y1 = Math.max(y1, y);
    }
  }
  return { x0, y0, x1, y1, w: x1 - x0, h: y1 - y0 };
}

/**
 * Segments to closed polylines in pixels (scale s, then offset). tol is the largest allowed
 * gap between a curve and its chords, in pixels.
 */
export function flatten(segs, s = 1, tol = 0.05, ox = 0, oy = 0) {
  const polys = [];
  let cur = null;
  let px = 0;
  let py = 0;
  for (const g of segs) {
    if (g.c === 'M') {
      if (cur && cur.length > 2) polys.push(cur);
      px = g.x * s + ox;
      py = g.y * s + oy;
      cur = [[px, py]];
    } else if (g.c === 'L') {
      px = g.x * s + ox;
      py = g.y * s + oy;
      cur.push([px, py]);
    } else if (g.c === 'Q') {
      const cx = g.cx * s + ox;
      const cy = g.cy * s + oy;
      const x = g.x * s + ox;
      const y = g.y * s + oy;
      const dd = Math.hypot(px - 2 * cx + x, py - 2 * cy + y);
      const n = Math.max(1, Math.ceil(Math.sqrt(dd / (4 * tol))));
      for (let i = 1; i <= n; i++) {
        const t = i / n;
        const u = 1 - t;
        cur.push([u * u * px + 2 * u * t * cx + t * t * x, u * u * py + 2 * u * t * cy + t * t * y]);
      }
      px = x;
      py = y;
    } else if (g.c === 'A') {
      const r = g.r * s;
      const span = g.a1 - g.a0;
      const step = r > tol ? 2 * Math.acos(Math.max(-1, 1 - tol / r)) : Math.PI / 2;
      const n = Math.max(2, Math.ceil(Math.abs(span) / Math.min(step, Math.PI / 8)));
      for (let i = 1; i <= n; i++) {
        const a = g.a0 + (span * i) / n;
        cur.push([(g.cx + g.r * Math.cos(a)) * s + ox, (g.cy + g.r * Math.sin(a)) * s + oy]);
      }
      [px, py] = cur[cur.length - 1];
    } else if (g.c === 'Z') {
      if (cur && cur.length > 2) polys.push(cur);
      cur = null;
    }
  }
  if (cur && cur.length > 2) polys.push(cur);
  return polys;
}

const num = (v) => {
  const r = Math.round(v * 1000) / 1000;
  return Object.is(r, -0) ? '0' : String(r);
};

/** Segments to an SVG path "d". Arcs are split into quarter turns at most, so flags stay simple. */
export function pathData(segs) {
  const out = [];
  for (const g of segs) {
    if (g.c === 'M' || g.c === 'L') out.push(`${g.c}${num(g.x)} ${num(g.y)}`);
    else if (g.c === 'Q') out.push(`Q${num(g.cx)} ${num(g.cy)} ${num(g.x)} ${num(g.y)}`);
    else if (g.c === 'A') {
      const span = g.a1 - g.a0;
      const n = Math.max(1, Math.ceil(Math.abs(span) / (Math.PI / 2) - 1e-9));
      const sweep = span > 0 ? 1 : 0;
      for (let i = 1; i <= n; i++) {
        const [x, y] = pt(g.cx, g.cy, g.r, g.a0 + (span * i) / n);
        out.push(`A${num(g.r)} ${num(g.r)} 0 0 ${sweep} ${num(x)} ${num(y)}`);
      }
    } else if (g.c === 'Z') out.push('Z');
  }
  return out.join('');
}
