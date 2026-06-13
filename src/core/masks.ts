import type { ProceduralMaskSpec, StrokeAlign } from "../types";

// Build a data-URI mask that is the pill shape (fill or outline ring), CROPPED at
// the mirror axis and then BLURRED - entirely in SVG (clip → feGaussianBlur, so the
// cut edge blurs too). Used as an ALPHA mask over a crisp conic gradient, so only
// the shape's edges are soft while the rainbow colours inside stay sharp.
export function buildMaskSvgUrl(opts: {
  canvasW: number;
  canvasH: number;
  shape: "fill" | "outline";
  pillLeft: number;
  pillTop: number;
  pillW: number;
  pillH: number;
  radiusPx: number;
  rotate?: number;
  gradAngle?: number;
  line: number;
  blur: number;
  clipLeft: number;
  /** Explicit clip rectangle (px, canvas space). Overrides `clipLeft` when set -
   *  used for top/bottom/left/right coverage. The sharp shape is clipped to this
   *  box and THEN blurred, so the cut seam is soft, not a hard rectangular edge. */
  clipRect?: { x: number; y: number; w: number; h: number };
  strokeAlign?: StrokeAlign;
}): string {
  const { canvasW, canvasH, shape, pillLeft, pillTop, pillW, pillH, radiusPx, line, blur, clipLeft, clipRect } = opts;
  // SVG strokes always straddle the path (centre-aligned). To emulate inside /
  // outside / centre alignment we offset the path rect so the resulting band sits
  // where the user expects relative to the pill edge.
  //   inside  → shrink the path by line/2 (outer band edge = pill edge)
  //   outside → grow the path by line/2 (inner band edge = pill edge)
  //   centre  → path = pill edge (band straddles it)
  const align = opts.strokeAlign ?? "inside";
  const off = align === "inside" ? line / 2 : align === "outside" ? -line / 2 : 0;
  const sx = pillLeft + off;
  const sy = pillTop + off;
  const sw = Math.max(0, pillW - off * 2);
  const sh = Math.max(0, pillH - off * 2);
  const srx = Math.max(0, radiusPx - off);
  // Rotation pivot = pill centre in canvas space
  const pcx = pillLeft + pillW / 2;
  const pcy = pillTop + pillH / 2;
  const rotAttr = opts.rotate
    ? ` transform='rotate(${opts.rotate},${pcx.toFixed(2)},${pcy.toFixed(2)})'`
    : "";
  const shapeEl =
    shape === "fill"
      ? `<rect x='${pillLeft}' y='${pillTop}' width='${pillW}' height='${pillH}' rx='${radiusPx}' ry='${radiusPx}' fill='#fff'${rotAttr}/>`
      : `<rect x='${sx}' y='${sy}' width='${sw}' height='${sh}' rx='${srx}' ry='${srx}' fill='none' stroke='#fff' stroke-width='${line}'${rotAttr}/>`;
  // Filter region spans the WHOLE canvas (userSpaceOnUse) so a large blur halo is
  // never clipped to the shape's small bounding box (which produced a hard
  // rectangular cut at high blur). The canvas itself carries enough halo margin.
  const filterDef =
    blur > 0
      ? `<filter id='b' filterUnits='userSpaceOnUse' x='0' y='0' width='${canvasW}' height='${canvasH}'><feGaussianBlur stdDeviation='${blur}'/></filter>`
      : "";
  const gOpen = blur > 0 ? `<g filter='url(#b)'>` : `<g>`;
  // Clip the sharp shape to the visible region, THEN blur the whole group (so the
  // cut seam softens). `clipRect` (top/bottom/left/right coverage) wins; otherwise
  // fall back to the legacy right-of-clipLeft crop.
  const cr = clipRect ?? { x: clipLeft, y: 0, w: Math.max(0, canvasW - clipLeft), h: canvasH };

  // Optional directional gradient: a linear gradient mask composited OVER the blurred
  // shape so the glow fades in a specific direction (e.g. 90° = strong left, fades right).
  // Uses CSS angle convention: 0° = bottom→top, 90° = left→right, 45° = bottom-left→top-right.
  let gradDefs = "";
  let gradWrapOpen = "";
  let gradWrapClose = "";
  if (opts.gradAngle != null) {
    const th = (opts.gradAngle * Math.PI) / 180;
    const halfDiag = Math.hypot(canvasW, canvasH) / 2;
    const cx = canvasW / 2;
    const cy = canvasH / 2;
    // "from" side (white/opaque) → "to" side (transparent), CSS convention
    const x1 = (cx - halfDiag * Math.sin(th)).toFixed(1);
    const y1 = (cy + halfDiag * Math.cos(th)).toFixed(1);
    const x2 = (cx + halfDiag * Math.sin(th)).toFixed(1);
    const y2 = (cy - halfDiag * Math.cos(th)).toFixed(1);
    gradDefs =
      `<linearGradient id='lg' gradientUnits='userSpaceOnUse' x1='${x1}' y1='${y1}' x2='${x2}' y2='${y2}'>` +
      `<stop offset='0' stop-color='#fff' stop-opacity='1'/>` +
      `<stop offset='1' stop-color='#fff' stop-opacity='0'/>` +
      `</linearGradient>` +
      `<mask id='gm'><rect x='0' y='0' width='${canvasW}' height='${canvasH}' fill='url(#lg)'/></mask>`;
    gradWrapOpen = `<g mask='url(#gm)'>`;
    gradWrapClose = `</g>`;
  }

  const svg =
    `<svg xmlns='http://www.w3.org/2000/svg' width='${canvasW}' height='${canvasH}' viewBox='0 0 ${canvasW} ${canvasH}'>` +
    `<defs>${filterDef}${gradDefs}<clipPath id='c'><rect x='${cr.x}' y='${cr.y}' width='${cr.w}' height='${cr.h}'/></clipPath></defs>` +
    `${gradWrapOpen}${gOpen}<g clip-path='url(#c)'>${shapeEl}</g></g>${gradWrapClose}</svg>`;
  // spaces → %20; encode < > # for data URI
  return `url("data:image/svg+xml,${svg.replace(/"/g, "'").replace(/</g, "%3C").replace(/>/g, "%3E").replace(/#/g, "%23").replace(/\s+/g, "%20")}")`;
}

// Resolve a spec into concrete pixel geometry for a card of size cardW × cardH.
// Everything is CARD-RELATIVE (w/h/cx/cy are fractions of the card, not a fixed
// source canvas), so the shape tracks the card border at any width/height. A halo
// margin around the card holds the blur. Returns the canvas + pill + crop in px,
// ready for buildMaskSvgUrl, plus where to place the canvas relative to the card.
export function resolvePillGeometry(
  spec: ProceduralMaskSpec,
  cardW: number,
  cardH: number,
  extraBlur = 0,
  scaleShape = 1,
  // The card's own corner radius in px. `radius: 1` resolves to exactly this, so a
  // full-card outline traces the card border and the glow corners are never wrong.
  // Defaults to a capsule (min(card)/2) when the host card radius isn't supplied.
  cardRadiusPx = Math.min(cardW, cardH) / 2,
) {
  // line/blur are LITERAL px - they are NOT scaled by card size, so the numbers you
  // set hold exactly at any width/height (a 7px line is 7px on a tiny or huge card).
  const blur = Math.max(0, spec.blur + extraBlur);
  const line = Math.max(1, spec.line * scaleShape);
  // halo margin must also clear an outward-aligned stroke (line/2 beyond the pill).
  const halo = Math.ceil(Math.max(blur * 4 + line / 2, 28));
  const canvasW = cardW + halo * 2;
  const canvasH = cardH + halo * 2;
  const pillW = spec.w * cardW * scaleShape;
  const pillH = spec.h * cardH * scaleShape;
  const pillLeft = halo + spec.cx * cardW - pillW / 2;
  const pillTop = halo + spec.cy * cardH - pillH / 2;
  // radius ≤ 1 → fraction of the card's corner radius (1 = match the card exactly);
  // > 1 → literal px. Clamped so it never exceeds the pill's own half-extent.
  const radiusPx = Math.min(
    spec.radius <= 1 ? spec.radius * cardRadiusPx : spec.radius,
    Math.min(pillW, pillH) / 2,
  );
  const clipLeft = halo + (spec.cropLeft ?? 0) * cardW;
  return { blur, line, halo, canvasW, canvasH, pillW, pillH, pillLeft, pillTop, radiusPx, clipLeft };
}
