export const smoothstep = (e0: number, e1: number, x: number): number => {
  const t = Math.max(0, Math.min(1, (x - e0) / (e1 - e0 || 1)));
  return t * t * (3 - 2 * t);
};

// CSS timing-function → JS, so the rAF-driven flash follows the EXACT same curve
// as the original CSS-keyframe flash (`easing` option, default the original
// cubic-bezier(0.26, 0.94, 0.6, 1)). Newton-solve x(t)=x, return y(t).
export function cubicBezierEase(x1: number, y1: number, x2: number, y2: number) {
  const at = (a: number, b: number, t: number) =>
    3 * (1 - t) * (1 - t) * t * a + 3 * (1 - t) * t * t * b + t * t * t;
  return (x: number): number => {
    if (x <= 0) return 0;
    if (x >= 1) return 1;
    let t = x;
    for (let i = 0; i < 6; i++) {
      const err = at(x1, x2, t) - x;
      const d = 3 * (1 - t) * (1 - t) * x1 + 6 * (1 - t) * t * (x2 - x1) + 3 * t * t * (1 - x2);
      if (Math.abs(d) < 1e-6) break;
      t = Math.max(0, Math.min(1, t - err / d));
    }
    return at(y1, y2, t);
  };
}

const EASE_KEYWORD_PTS: Record<string, [number, number, number, number]> = {
  linear: [0, 0, 1, 1],
  ease: [0.25, 0.1, 0.25, 1],
  "ease-in": [0.42, 0, 1, 1],
  "ease-out": [0, 0, 0.58, 1],
  "ease-in-out": [0.42, 0, 0.58, 1],
};

export function easingToFn(css: string): (x: number) => number {
  const m = css.match(/cubic-bezier\(([^)]+)\)/);
  const pts = m
    ? (m[1].split(",").map(Number) as number[])
    : EASE_KEYWORD_PTS[css.trim()] ?? [0.26, 0.94, 0.6, 1];
  if (pts.length !== 4 || pts.some((v) => !Number.isFinite(v)))
    return cubicBezierEase(0.26, 0.94, 0.6, 1);
  return cubicBezierEase(pts[0], pts[1], pts[2], pts[3]);
}
