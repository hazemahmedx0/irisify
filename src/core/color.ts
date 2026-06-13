import type { OklchStop, StopAngles } from "../types";
import { DEFAULT_STOP_ANGLES } from "../defaults";

export function stopCss(s: OklchStop): string {
  const v = `${s.l.toFixed(3)} ${s.c.toFixed(3)} ${s.h.toFixed(1)}`;
  return s.a >= 0.99 ? `oklch(${v})` : `oklch(${v} / ${s.a.toFixed(3)})`;
}

// Sample the rainbow at p∈[0,1]. `cyclic` wraps the LAST stop back to the FIRST
// (n segments, not n−1) so a full-loop flow blends seamlessly instead of cutting
// where pink meets blue.
export function sampleRainbow(stops: OklchStop[], p: number, cyclic = false): OklchStop {
  const n = stops.length;
  if (n === 1) return stops[0];
  let i: number, f: number, a: OklchStop, b: OklchStop;
  if (cyclic) {
    const pp = ((p % 1) + 1) % 1;
    const x = pp * n;
    i = Math.floor(x) % n;
    f = x - Math.floor(x);
    a = stops[i];
    b = stops[(i + 1) % n];
  } else {
    const x = Math.max(0, Math.min(1, p)) * (n - 1);
    i = Math.floor(x);
    f = x - i;
    a = stops[i];
    b = stops[Math.min(i + 1, n - 1)];
  }
  // Hue takes the SHORTEST path around the wheel - a numeric lerp from red (27°)
  // to magenta (316°) would detour through yellow/green/cyan/blue, polluting the
  // blend with foreign colours and packing a full rainbow of hue change into one
  // segment (which then aliases into visible steps at gradient resolution).
  let dh = b.h - a.h;
  if (dh > 180) dh -= 360;
  else if (dh < -180) dh += 360;
  const hh = (((a.h + dh * f) % 360) + 360) % 360;
  return { l: a.l + (b.l - a.l) * f, c: a.c + (b.c - a.c) * f, h: hh, a: a.a + (b.a - a.a) * f };
}

export function oklchA(s: OklchStop, alpha: number): string {
  const al = Math.max(0, Math.min(1, s.a * alpha));
  if (al <= 0.001) return "transparent";
  return `oklch(${s.l.toFixed(3)} ${s.c.toFixed(3)} ${s.h.toFixed(1)} / ${al.toFixed(3)})`;
}

// OKLCH → gamma sRGB [0..1]. The original flash conic is `in srgb` - the browser
// converts each oklch stop to sRGB and lerps componentwise. The JS flash must
// blend the same way or its rainbow reads as a different palette.
export function oklchToRgb(s: OklchStop): [number, number, number] {
  const hr = (s.h * Math.PI) / 180;
  const a = s.c * Math.cos(hr),
    b = s.c * Math.sin(hr);
  const l_ = s.l + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = s.l - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = s.l - 0.0894841775 * a - 1.291485548 * b;
  const l3 = l_ ** 3,
    m3 = m_ ** 3,
    s3 = s_ ** 3;
  const lin = [
    4.0767416621 * l3 - 3.3077115913 * m3 + 0.2309699292 * s3,
    -1.2684380046 * l3 + 2.6097574011 * m3 - 0.3413193965 * s3,
    -0.0041960863 * l3 - 0.7034186147 * m3 + 1.707614701 * s3,
  ];
  return lin.map((x) => {
    x = Math.max(0, Math.min(1, x));
    return x <= 0.0031308 ? 12.92 * x : 1.055 * Math.pow(x, 1 / 2.4) - 0.055;
  }) as [number, number, number];
}

// gamma sRGB [0..1] (+ alpha) → OKLCH. Inverse of the above - used to accept
// plain CSS colour strings at the simple API level.
export function rgbToOklch(r: number, g: number, b: number, a = 1): OklchStop {
  const lin = [r, g, b].map((x) =>
    x <= 0.04045 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4),
  );
  const l = 0.4122214708 * lin[0] + 0.5363325363 * lin[1] + 0.0514459929 * lin[2];
  const m = 0.2119034982 * lin[0] + 0.6806995451 * lin[1] + 0.1073969566 * lin[2];
  const s = 0.0883024619 * lin[0] + 0.2817188376 * lin[1] + 0.6299787005 * lin[2];
  const l_ = Math.cbrt(l),
    m_ = Math.cbrt(m),
    s_ = Math.cbrt(s);
  const L = 0.2104542553 * l_ + 0.793617785 * m_ - 0.0040720468 * s_;
  const A = 1.9779984951 * l_ - 2.428592205 * m_ + 0.4505937099 * s_;
  const B = 0.0259040371 * l_ + 0.7827717662 * m_ - 0.808675766 * s_;
  const C = Math.hypot(A, B);
  let H = (Math.atan2(B, A) * 180) / Math.PI;
  if (H < 0) H += 360;
  return { l: L, c: C, h: H, a };
}

const hslToRgb = (h: number, s: number, l: number): [number, number, number] => {
  h = ((h % 360) + 360) % 360;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  const [r, g, b] =
    h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] :
    h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  return [r + m, g + m, b + m];
};

/** Parse a CSS colour string (#hex, rgb(a), hsl(a), oklch) into an OKLCH stop.
 *  Returns null for anything it can't read. */
export function parseColor(css: string): OklchStop | null {
  const str = css.trim().toLowerCase();
  let m = str.match(/^#([0-9a-f]{3,8})$/);
  if (m) {
    const hx = m[1];
    const exp = (i: number, len: number) =>
      parseInt(len === 1 ? hx[i] + hx[i] : hx.slice(i, i + 2), 16) / 255;
    if (hx.length === 3 || hx.length === 4) {
      const a = hx.length === 4 ? exp(3, 1) : 1;
      return rgbToOklch(exp(0, 1), exp(1, 1), exp(2, 1), a);
    }
    if (hx.length === 6 || hx.length === 8) {
      const a = hx.length === 8 ? exp(6, 2) : 1;
      return rgbToOklch(exp(0, 2), exp(2, 2), exp(4, 2), a);
    }
    return null;
  }
  m = str.match(/^rgba?\(([^)]+)\)$/);
  if (m) {
    const parts = m[1].split(/[\s,\/]+/).filter(Boolean);
    if (parts.length < 3) return null;
    const ch = (v: string) => (v.endsWith("%") ? parseFloat(v) / 100 : parseFloat(v) / 255);
    const al = (v?: string) =>
      v === undefined ? 1 : v.endsWith("%") ? parseFloat(v) / 100 : parseFloat(v);
    return rgbToOklch(ch(parts[0]), ch(parts[1]), ch(parts[2]), al(parts[3]));
  }
  m = str.match(/^hsla?\(([^)]+)\)$/);
  if (m) {
    const parts = m[1].split(/[\s,\/]+/).filter(Boolean);
    if (parts.length < 3) return null;
    const h = parseFloat(parts[0]);
    const s = parseFloat(parts[1]) / 100;
    const l = parseFloat(parts[2]) / 100;
    const a =
      parts[3] === undefined
        ? 1
        : parts[3].endsWith("%")
          ? parseFloat(parts[3]) / 100
          : parseFloat(parts[3]);
    const [r, g, b] = hslToRgb(h, s, l);
    return rgbToOklch(r, g, b, a);
  }
  m = str.match(/^oklch\(([^)]+)\)$/);
  if (m) {
    const [main, alphaPart] = m[1].split("/");
    const parts = main.trim().split(/\s+/);
    if (parts.length < 3) return null;
    const l = parts[0].endsWith("%") ? parseFloat(parts[0]) / 100 : parseFloat(parts[0]);
    const c = parts[1].endsWith("%") ? parseFloat(parts[1]) * 0.004 : parseFloat(parts[1]);
    const h = parseFloat(parts[2]);
    const a = alphaPart
      ? alphaPart.trim().endsWith("%")
        ? parseFloat(alphaPart) / 100
        : parseFloat(alphaPart)
      : 1;
    if (![l, c, h, a].every(Number.isFinite)) return null;
    return { l, c, h, a };
  }
  return null;
}

// ─── Flash wedge colour profile ───────────────────────────────────────────────

export type RgbaStop = [number, number, number, number];

export const rgbaCss = (c: RgbaStop, alpha: number): string => {
  const al = Math.max(0, Math.min(1, c[3] * alpha));
  if (al <= 0.001) return "transparent";
  return `rgba(${Math.round(c[0] * 255)},${Math.round(c[1] * 255)},${Math.round(c[2] * 255)},${al.toFixed(3)})`;
};

export const lerpRgba = (a: RgbaStop, b: RgbaStop, f: number): RgbaStop => [
  a[0] + (b[0] - a[0]) * f,
  a[1] + (b[1] - a[1]) * f,
  a[2] + (b[2] - a[2]) * f,
  a[3] + (b[3] - a[3]) * f,
];

// The original flash wedge's colour profile, replicated exactly. Layout (conic
// degrees, head at 0°): c0@0, c1@stop2, … c(n−2)@stop(n−1), fading to transparent
// at stop(n) - plus the LEADING sliver ahead of the head (324→349→360 in the
// original = transparent→c(n−1)→c0 over 36°/11° at stop(n)=72°), which is what
// gives the original its soft luminous head. All positions normalised to the
// trailing span; all blending in sRGB.
export type WedgeProfile = {
  rgb: RgbaStop[];
  trailPos: number[]; // positions of c0..c(n−2), 0..<1
  leadExt: number; // leading extent ahead of the head, in trailing-span units
  leadC5: number; // where the lead colour sits fully ahead of the head
};

export function makeWedgeProfile(stops: OklchStop[], angles?: StopAngles): WedgeProfile {
  const rgb = stops.map((s) => [...oklchToRgb(s), s.a] as RgbaStop);
  const n = stops.length;
  const a = angles ?? DEFAULT_STOP_ANGLES;
  const seq = [0, a.stop2, a.stop3, a.stop4, a.stop5, a.stop6, a.stop7];
  const span = seq[Math.min(n, seq.length - 1)] || 84; // transparent stop = wedge width
  const trailPos = Array.from({ length: n - 1 }, (_, i) => Math.min(0.98, seq[i] / span));
  return { rgb, trailPos, leadExt: 36 / span, leadC5: 11 / span };
}

// d = distance behind the head in trailing-span units (negative = ahead of it).
// Numeric so overlapping flash flights can be COMPOSITED before stringifying;
// the profile's own fades are folded into the returned alpha.
export function sampleWedgeRgba(w: WedgeProfile, d: number): RgbaStop | null {
  const n = w.rgb.length;
  if (d >= 1 || d <= -w.leadExt) return null;
  if (d < 0) {
    const x = -d;
    if (x <= w.leadC5) return lerpRgba(w.rgb[0], w.rgb[n - 1], x / w.leadC5);
    const f = (x - w.leadC5) / (w.leadExt - w.leadC5 || 1e-6);
    const c = w.rgb[n - 1];
    return [c[0], c[1], c[2], c[3] * (1 - f)];
  }
  const last = w.trailPos.length - 1; // index of c(n−2)
  if (d >= w.trailPos[last]) {
    const c = w.rgb[last];
    return [c[0], c[1], c[2], c[3] * (1 - (d - w.trailPos[last]) / (1 - w.trailPos[last] || 1e-6))];
  }
  let i = 0;
  while (i < last && d > w.trailPos[i + 1]) i++;
  const f = (d - w.trailPos[i]) / (w.trailPos[i + 1] - w.trailPos[i] || 1e-6);
  return lerpRgba(w.rgb[i], w.rgb[i + 1], f);
}

// src-over composite of non-premultiplied rgba (`a` on top of `b`).
export const overRgba = (a: RgbaStop, b: RgbaStop): RgbaStop => {
  const ao = a[3] + b[3] * (1 - a[3]);
  if (ao <= 1e-6) return [0, 0, 0, 0];
  const w1 = a[3] / ao;
  const w2 = (b[3] * (1 - a[3])) / ao;
  return [a[0] * w1 + b[0] * w2, a[1] * w1 + b[1] * w2, a[2] * w1 + b[2] * w2, ao];
};

// Cyclic sRGB blend of the stops - the hold-mode flow uses the SAME palette and
// blend space as the flash wedge so "stay lit" keeps the original rainbow.
export function sampleCyclicRgb(rgb: RgbaStop[], t: number, alpha: number): string {
  const n = rgb.length;
  const pp = ((t % 1) + 1) % 1;
  const x = pp * n;
  const i = Math.floor(x) % n;
  return rgbaCss(lerpRgba(rgb[i], rgb[(i + 1) % n], x - Math.floor(x)), alpha);
}
