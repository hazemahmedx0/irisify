import type { Side } from "../types";

// ─── Perimeter engine: map colour to BORDER ARC-LENGTH (not angle) ───────────
// A conic gradient glues colour to ANGLE. On a non-square card, equal angle ≠
// equal border length (an edge covers hh·sec²θ px per degree), so any rigid
// rotation races at the corners - unfixable by re-timing alone. The fix: build
// the conic stops so that colour is a function of PERIMETER position, then scroll
// along the perimeter. Equal time → equal border distance, everywhere, for any
// aspect ratio. This also gives an exact start/end window + featherable ends.

type Outline = {
  segs: {
    type: "line" | "arc";
    len: number;
    x0: number;
    y0: number;
    x1: number;
    y1: number;
    cx: number;
    cy: number;
    a0: number;
    a1: number;
    r: number;
  }[];
  L: number;
};

// Rounded-rect outline, origin at TOP-CENTRE, walked CLOCKWISE - so perimeter
// fraction 0 = top-centre and grows the same direction as a screen angle.
function buildOutline(hw: number, hh: number, r: number): Outline {
  r = Math.max(0, Math.min(r, Math.min(hw, hh)));
  const segs: Outline["segs"] = [];
  const line = (x0: number, y0: number, x1: number, y1: number) =>
    segs.push({ type: "line", len: Math.hypot(x1 - x0, y1 - y0), x0, y0, x1, y1, cx: 0, cy: 0, a0: 0, a1: 0, r: 0 });
  const arc = (cx: number, cy: number, a0: number, a1: number) =>
    segs.push({ type: "arc", len: Math.abs(a1 - a0) * r, x0: 0, y0: 0, x1: 0, y1: 0, cx, cy, a0, a1, r });
  line(0, -hh, hw - r, -hh);
  arc(hw - r, -hh + r, -Math.PI / 2, 0); // top-right
  line(hw, -hh + r, hw, hh - r);
  arc(hw - r, hh - r, 0, Math.PI / 2); // bottom-right
  line(hw - r, hh, -(hw - r), hh);
  arc(-(hw - r), hh - r, Math.PI / 2, Math.PI); // bottom-left
  line(-hw, hh - r, -hw, -(hh - r));
  arc(-(hw - r), -(hh - r), Math.PI, (3 * Math.PI) / 2); // top-left
  line(-(hw - r), -hh, 0, -hh);
  return { segs, L: segs.reduce((s, g) => s + g.len, 0) };
}

function pointAtLength(o: Outline, dist: number): { x: number; y: number } {
  let d = ((dist % o.L) + o.L) % o.L;
  for (const s of o.segs) {
    if (d <= s.len) {
      const f = s.len ? d / s.len : 0;
      if (s.type === "line") return { x: s.x0 + (s.x1 - s.x0) * f, y: s.y0 + (s.y1 - s.y0) * f };
      const a = s.a0 + (s.a1 - s.a0) * f;
      return { x: s.cx + Math.cos(a) * s.r, y: s.cy + Math.sin(a) * s.r };
    }
    d -= s.len;
  }
  return { x: 0, y: -1 };
}

// angle (0° = up, clockwise) → perimeter fraction, and the inverse. Built once
// per geometry; both directions are monotonic so we interpolate a sample table.
// `sides` holds each side's [start,end] perimeter fraction (corners split at their
// midpoints), and `L` the total perimeter px (for px-based widths).
export type SideArc = { start: number; end: number };
export type PerimeterMap = {
  angs: number[];
  steps: number;
  L: number;
  sides: Record<Side, SideArc>;
};

export function makePerimeterMap(hw: number, hh: number, r: number, steps = 720): PerimeterMap {
  const o = buildOutline(hw, hh, r);
  const angs: number[] = [];
  for (let i = 0; i < steps; i++) {
    const p = pointAtLength(o, (i / steps) * o.L);
    let a = (Math.atan2(p.x, -p.y) * 180) / Math.PI;
    if (a < 0) a += 360;
    angs.push(a);
  }
  // segment order: 0 top-right-half, 1 TR, 2 right, 3 BR, 4 bottom, 5 BL, 6 left,
  // 7 TL, 8 top-left-half. Sides split at corner midpoints.
  const len = o.segs.map((s) => s.len);
  const cum: number[] = [];
  let acc = 0;
  for (const l of len) {
    cum.push(acc);
    acc += l;
  }
  const f = (i: number, half = false) => (cum[i] + (half ? len[i] / 2 : 0)) / o.L;
  const midTR = f(1, true),
    midBR = f(3, true),
    midBL = f(5, true),
    midTL = f(7, true);
  const sides: Record<Side, SideArc> = {
    top: { start: midTL, end: midTR }, // wraps through 0
    right: { start: midTR, end: midBR },
    bottom: { start: midBR, end: midBL },
    left: { start: midBL, end: midTL },
  };
  return { angs, steps, L: o.L, sides };
}

// Merge a set of selected sides into contiguous [start,span] arcs (adjacent sides
// fuse so feather only appears at the OUTER ends, not between them). Empty/all → full.
export function sidesToArcs(map: PerimeterMap, sides: Side[]): { start: number; span: number }[] {
  const order: Side[] = ["top", "right", "bottom", "left"];
  const sel = order.map((s) => sides.includes(s));
  if (sel.every(Boolean) || !sel.some(Boolean)) return [{ start: 0, span: 1 }];
  const startIdx = sel.findIndex((v) => !v); // begin on an unselected side → no wrap-run
  const arcs: { start: number; span: number }[] = [];
  let i = 0;
  while (i < 4) {
    const idx = (startIdx + i) % 4;
    if (!sel[idx]) {
      i++;
      continue;
    }
    const run: number[] = [];
    let j = i;
    while (j < 4 && sel[(startIdx + j) % 4]) {
      run.push((startIdx + j) % 4);
      j++;
    }
    const first = map.sides[order[run[0]]];
    const last = map.sides[order[run[run.length - 1]]];
    let span = last.end - first.start;
    if (span <= 0) span += 1;
    arcs.push({ start: first.start, span });
    i = j;
  }
  return arcs;
}

// perimeter fraction (0–1) of a given screen angle
export function fracAtAngle(map: PerimeterMap, angle: number): number {
  let a = ((angle % 360) + 360) % 360;
  const { angs, steps } = map;
  // angs is monotonically increasing from ~0; binary-ish scan
  for (let i = 0; i < steps; i++) {
    const cur = angs[i];
    const nxt = i + 1 < steps ? angs[i + 1] : angs[0] + 360;
    if (a >= cur && a < nxt) return (i + (a - cur) / (nxt - cur || 1)) / steps;
  }
  return 0;
}

// inverse: perimeter fraction → screen angle (used to place conic stops at equal
// perimeter spacing so the colour delta per stop is uniform - no corner banding).
export function angleAtFrac(map: PerimeterMap, frac: number): number {
  const { angs, steps } = map;
  const x = (((frac % 1) + 1) % 1) * steps;
  const i = Math.floor(x) % steps;
  const f = x - Math.floor(x);
  const a0 = angs[i];
  const a1 = i + 1 < steps ? angs[i + 1] : angs[0] + 360;
  return (((a0 + (a1 - a0) * f) % 360) + 360) % 360;
}
