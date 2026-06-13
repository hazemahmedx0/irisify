import type { GlowLayer, MaskIndex, ProceduralMaskSpec } from "../types";
import type { ResolvedConfig } from "../resolve";
import { PROCEDURAL_MASK_SPECS } from "../defaults";
import { buildMaskSvgUrl, resolvePillGeometry } from "../core/masks";

// The original component authored half the effect and mirrored it left↔right.
const MIRROR_TRANSFORM = "scaleX(-1)";

/** Legacy ring slice (kept for the procedural clip rect). */
type Coverage = "full" | "top" | "bottom" | "left" | "right";

export type LayerContext = {
  doc: Document;
  cls: string;
  w: number;
  h: number;
  /** Host corner radius in px (already clamped to min(w,h)/2). */
  radius: number;
  config: ResolvedConfig;
  sideFlash: boolean;
  jsGradient: boolean;
};

const div = (doc: Document, className?: string): HTMLDivElement => {
  const d = doc.createElement("div");
  if (className) d.className = className;
  return d;
};

const setMask = (el: HTMLElement, image: string, size: string) => {
  for (const p of ["-webkit-mask-image", "mask-image"]) el.style.setProperty(p, image);
  for (const p of ["-webkit-mask-size", "mask-size"]) el.style.setProperty(p, size);
  for (const p of ["-webkit-mask-repeat", "mask-repeat"]) el.style.setProperty(p, "no-repeat");
  for (const p of ["-webkit-mask-position", "mask-position"]) el.style.setProperty(p, "center");
};

// Gradient element - fills the w × h centred area (geometry via the --iris-w/-h
// vars set on the overlay containers, exactly like the original's CSS calc()s).
function gradDiv(ctx: LayerContext, extra?: (el: HTMLDivElement) => void): HTMLDivElement {
  const g = div(ctx.doc, `iris-grad ${ctx.cls}`);
  g.dataset.playing = "true";
  Object.assign(g.style, {
    position: "absolute",
    left: "calc(50% - var(--iris-w) / 2)",
    top: "calc(50% - var(--iris-h) / 2)",
    height: "var(--iris-h)",
    width: "var(--iris-w)",
    borderRadius: `${ctx.radius}px`,
  });
  extra?.(g);
  return g;
}

// Blurred + cropped pill shape as an ALPHA mask over a crisp, full-canvas conic
// gradient. The gradient is angular about its centre (= the card/canvas centre),
// so painting it over the whole canvas matches the original card-sized gradient
// - the rainbow stays sharp and only the shape's edges soften.
function proceduralLine(
  ctx: LayerContext,
  o: {
    mask: MaskIndex;
    lw: number;
    lh: number;
    opacity?: number;
    blur?: number;
    outerScale?: number;
    /** When set, reveal only this slice of the ring (overrides the spec's cropLeft). */
    coverage?: Coverage;
    /** Optional conic alpha mask (perimeter window) composited with the shape mask
     *  to confine flash to a placement arc. */
    windowMask?: string;
    /** Use this exact shape spec instead of the per-mask one (e.g. lights' soft halo). */
    specOverride?: ProceduralMaskSpec;
    /** Paint the cheap low-res gradient var (for heavily-blurred layers - detail is
     *  wasted after blur, and it keeps the per-frame raster light). */
    loRes?: boolean;
  },
): HTMLElement {
  const { lw, lh } = o;
  const spec =
    o.specOverride ?? ctx.config.proceduralSpecs?.[o.mask] ?? PROCEDURAL_MASK_SPECS[o.mask];
  // Card-relative geometry: the shape is sized to the actual card (lw × lh), so it
  // hugs the border at any width/height. outerScale slightly enlarges the shape +
  // line for the soft outer halo layers. ctx.radius is the host's real corner
  // radius so a full-card outline matches the host's corners exactly.
  const g = resolvePillGeometry(spec, lw, lh, o.blur ?? 0, o.outerScale ?? 1, ctx.radius);
  const { canvasW, canvasH, halo } = g;

  // Coverage clip (canvas space). Card centre sits at the canvas centre; clipping
  // there splits the ring into clean top/bottom/left/right halves. Undefined →
  // keep the spec's own cropLeft behaviour (used by the symmetric flash variant).
  const cxPx = canvasW / 2;
  const cyPx = canvasH / 2;
  const clipRect =
    o.coverage === "top" ? { x: 0, y: 0, w: canvasW, h: cyPx } :
    o.coverage === "bottom" ? { x: 0, y: cyPx, w: canvasW, h: canvasH - cyPx } :
    o.coverage === "left" ? { x: 0, y: 0, w: cxPx, h: canvasH } :
    o.coverage === "right" ? { x: cxPx, y: 0, w: canvasW - cxPx, h: canvasH } :
    o.coverage === "full" ? { x: 0, y: 0, w: canvasW, h: canvasH } :
    undefined;

  const maskUrl = buildMaskSvgUrl({
    canvasW,
    canvasH,
    shape: spec.shape,
    pillLeft: g.pillLeft,
    pillTop: g.pillTop,
    pillW: g.pillW,
    pillH: g.pillH,
    radiusPx: g.radiusPx,
    rotate: spec.rotate,
    gradAngle: spec.gradAngle,
    line: g.line,
    blur: g.blur,
    clipLeft: g.clipLeft,
    clipRect,
    strokeAlign: spec.strokeAlign,
  });

  const wrap = div(ctx.doc);
  Object.assign(wrap.style, {
    position: "absolute",
    left: `${ctx.w / 2 - lw / 2 - halo}px`,
    top: `${ctx.h / 2 - lh / 2 - halo}px`,
    width: `${canvasW}px`,
    height: `${canvasH}px`,
    opacity: String((o.opacity ?? 1) * spec.opacity),
    overflow: "visible",
    pointerEvents: "none",
  });

  const grad = div(ctx.doc, o.loRes ? `iris-grad ${ctx.cls} iris-lo` : `iris-grad ${ctx.cls}`);
  grad.dataset.playing = "true";
  Object.assign(grad.style, {
    position: "absolute",
    inset: "0",
    borderRadius: "0",
  });
  if (o.windowMask) {
    setMask(grad, `${maskUrl}, ${o.windowMask}`, "100% 100%, 100% 100%");
    // intersect the shape mask with the window so flash is confined to the arc
    grad.style.setProperty("-webkit-mask-composite", "source-in");
    grad.style.setProperty("mask-composite", "intersect");
  } else {
    setMask(grad, maskUrl, "100% 100%");
  }
  wrap.appendChild(grad);
  return wrap;
}

// ── Border glow (1-px rainbow ring via mask-composite) ────────────────────────
function borderSide(ctx: LayerContext, o: { mirror?: boolean; windowMask?: string }): HTMLElement {
  const root = div(ctx.doc, "iris-overlay");
  if (o.mirror) root.style.transform = MIRROR_TRANSFORM;

  const maskBorder = div(ctx.doc, "iris-mask-border");
  Object.assign(maskBorder.style, {
    position: "absolute",
    inset: "0",
    overflow: "visible",
    padding: "1px",
    height: "var(--iris-h)",
    width: "var(--iris-w)",
    borderRadius: `${ctx.radius}px`,
  });

  const core = div(ctx.doc, "iris-mask-core iris-overlay");

  // Fill the full card area so the gradient reaches every point on the border
  // ring at any aspect ratio.
  const fill = div(ctx.doc);
  Object.assign(fill.style, { position: "absolute", inset: "0" });
  setMask(fill, "linear-gradient(white, white)", "100% 100%");

  // Confine flash to a placement arc by masking the colour with the window conic.
  const grad = gradDiv(ctx, (el) => {
    if (o.windowMask) setMask(el, o.windowMask, "100% 100%");
  });

  fill.appendChild(grad);
  core.appendChild(fill);
  maskBorder.appendChild(core);
  root.appendChild(maskBorder);
  return root;
}

// ── Inner masked glow ─────────────────────────────────────────────────────────
function maskedGlowSide(
  ctx: LayerContext,
  o: { mirror?: boolean; coverage?: Coverage; windowMask?: string },
): HTMLElement {
  const root = div(ctx.doc, "iris-overlay");
  if (o.mirror) root.style.transform = MIRROR_TRANSFORM;
  const box = div(ctx.doc);
  Object.assign(box.style, {
    position: "absolute",
    right: "0",
    top: "0",
    height: "var(--iris-h)",
    width: "var(--iris-w)",
  });
  const active = ctx.config.innerLayers.filter((l: GlowLayer) => l.enabled);
  for (const layer of active) {
    const spec = ctx.config.proceduralSpecs?.[layer.mask] ?? PROCEDURAL_MASK_SPECS[layer.mask];
    // The original flash paints UNCROPPED (full-ring) specs twice - once per
    // mirror copy, overlaid. The single-pass sideFlash doubles them so the ring
    // keeps the same saturation. (Cropped specs covered each half exactly once
    // in the original = one full-coverage pass here.)
    const copies = ctx.sideFlash && !((spec.cropLeft ?? 0) > 0) ? 2 : 1;
    for (let ci = 0; ci < copies; ci++) {
      box.appendChild(
        proceduralLine(ctx, {
          mask: layer.mask,
          lw: layer.layerW ?? ctx.w,
          lh: layer.layerH ?? ctx.h,
          opacity: layer.opacity,
          blur: layer.blur,
          coverage: o.coverage,
          windowMask: o.windowMask,
        }),
      );
    }
  }
  root.appendChild(box);
  return root;
}

// ── Outer soft glow (extends beyond bounds - rendered in the UNDER overlay,
//    which paints behind the host element exactly like the original's z -10) ──
function outerGlowSide(
  ctx: LayerContext,
  o: { mirror?: boolean; extra?: boolean; coverage?: Coverage; windowMask?: string },
): HTMLElement {
  const { w, h, config } = ctx;
  const motion = config.motion;
  // The default outer-glow shape (mask 1) is a soft FILLED blob sitting RIGHT of
  // centre (cx 0.75) - gives the flash its soft bloom, but it's lopsided for
  // `lights` (which never mirrors). For lights use a symmetric, heavily-blurred
  // FILLED halo (full card) so it keeps the flash's soft glow quality while being
  // even all the way round; the windowed gradient confines the colour to the arc.
  const softHalo: ProceduralMaskSpec = {
    shape: "fill", w: 1, h: 1, cx: 0.5, cy: 0.5, radius: 1,
    line: 0, blur: 0, opacity: 0.5, cropLeft: 0, strokeAlign: "inside",
  };
  const revealHalo: ProceduralMaskSpec = {
    shape: "outline", w: 1, h: 1, cx: 0.5, cy: 0.5, radius: 1,
    line: 9, blur: 0, opacity: 0.58, cropLeft: 0, strokeAlign: "center",
  };
  // Side-cap bloom (sideFlash only). The card-shaped halo gives the long edges a
  // wide blurred apron but the short caps only a sliver, so any launch / arrival
  // / sweep-through at a cap reads as crammed crisp stripes instead of the B→T
  // soft wash. These blobs sit ON the caps and add the missing apron there; the
  // windowed gradient keeps them dark until colour actually reaches a cap, so
  // flat-edge moments are untouched. FAINT and almost entirely inside the card
  // end - the blur alone provides the apron; any real overhang reads as a
  // streaky conic fan. Sized in CARD-HEIGHT units (the cap radius is h/2 -
  // width-relative sizing ballooned on wide cards).
  const capHalo = (side: 0 | 1): ProceduralMaskSpec => {
    const bw = (1.15 * h) / w; // blob width ≈ 1.15 × card height
    const cxIn = (0.5 * h) / w; // centre h/2 inside the card end
    return {
      shape: "fill", w: bw, h: 1.08, cx: side === 0 ? cxIn : 1 - cxIn, cy: 0.5,
      radius: 1, line: 0, blur: 15, opacity: 0.11, cropLeft: 0, strokeAlign: "inside",
    };
  };
  // The outer-glow tuner edits proceduralSpecs[outerGlowMask], but the JS paths
  // replace the shape with the curated halos above (the stock mask 1 is authored
  // lopsided - cx 0.75 - for the mirrored CSS flash). If the user has TOUCHED
  // the spec, honor their shape instead; otherwise the override reads as dead
  // for lights / custom directions / Stay lit.
  const userSpec = config.proceduralSpecs?.[config.outerGlowMask];
  const userTuned =
    userSpec && JSON.stringify(userSpec) !== JSON.stringify(PROCEDURAL_MASK_SPECS[config.outerGlowMask]);
  const tunedHalo: ProceduralMaskSpec | undefined = userTuned ? userSpec : undefined;
  // The original always paints the outer blob TWICE - main + an X-mirrored copy
  // (cx 0.75 → blobs on BOTH sides). The JS paths are single-pass, so a tuned
  // spec gets an explicit second pass with REFLECTED geometry instead. Only the
  // mask shape reflects - mirroring the gradient itself would paint the flash
  // reflected (the old ghosting bug).
  const tunedHaloMirror: ProceduralMaskSpec | undefined = tunedHalo
    ? {
        ...tunedHalo,
        cx: 1 - tunedHalo.cx,
        rotate: tunedHalo.rotate != null ? -tunedHalo.rotate : undefined,
        gradAngle: tunedHalo.gradAngle != null ? -tunedHalo.gradAngle : undefined,
      }
    : undefined;

  const root = div(ctx.doc, "iris-overlay");
  Object.assign(root.style, {
    zIndex: "-10",
    opacity: String(config.outerGlowOpacity),
  });
  if (o.mirror) root.style.transform = MIRROR_TRANSFORM;
  const box = div(ctx.doc);
  Object.assign(box.style, {
    position: "absolute",
    right: "0",
    top: "0",
    height: "var(--iris-h)",
    width: "var(--iris-w)",
  });

  box.appendChild(
    proceduralLine(ctx, {
      mask: config.outerGlowMask,
      specOverride: motion.reveal
        ? revealHalo
        : // lights AND sideFlash: symmetric full-card halo - the windowed
          // gradient confines the bloom, so it follows the lit arms exactly.
          // sideFlash matches the ORIGINAL's outer bloom weight: mask 1 is
          // opacity 0.155 ×2 passes ≈ 0.31, diffused by spec blur 15 ON TOP of
          // the pass blur.
          ctx.jsGradient
          ? tunedHalo ?? (ctx.sideFlash ? { ...softHalo, blur: 15, opacity: 0.31 } : softHalo)
          : undefined,
      lw: w,
      lh: h,
      blur: config.outerGlowBlur + (ctx.jsGradient ? (motion.reveal ? 14 : 8) : 8),
      opacity: 1,
      outerScale: 1.02,
      coverage: o.coverage,
      windowMask: o.windowMask,
      loRes: ctx.jsGradient,
    }),
  );
  if (tunedHaloMirror && !motion.reveal) {
    box.appendChild(
      proceduralLine(ctx, {
        mask: config.outerGlowMask,
        specOverride: tunedHaloMirror,
        lw: w,
        lh: h,
        blur: config.outerGlowBlur + 8,
        opacity: 1,
        outerScale: 1.02,
        coverage: o.coverage,
        windowMask: o.windowMask,
        loRes: true,
      }),
    );
  }
  if (ctx.sideFlash && !motion.reveal) {
    for (const cxv of [0, 1] as const) {
      box.appendChild(
        proceduralLine(ctx, {
          mask: config.outerGlowMask,
          specOverride: capHalo(cxv),
          lw: w,
          lh: h,
          blur: config.outerGlowBlur + 8,
          opacity: 1,
          outerScale: 1.02,
          coverage: o.coverage,
          windowMask: o.windowMask,
          loRes: true,
        }),
      );
    }
  }
  if (o.extra) {
    box.appendChild(
      proceduralLine(ctx, { mask: 3, lw: w, lh: h, blur: 6, opacity: 1, outerScale: 1.01, coverage: o.coverage, windowMask: o.windowMask }),
    );
    box.appendChild(
      proceduralLine(ctx, { mask: 2, lw: w, lh: h, blur: 8, opacity: 1, outerScale: 1.02, coverage: o.coverage, windowMask: o.windowMask }),
    );
  }
  root.appendChild(box);
  return root;
}

// ── Assembly - the original component's top-level render logic ───────────────
export function buildLayers(
  ctx: LayerContext,
  o: {
    moving: boolean;
    flashWindowMask?: string;
    flashWindowMaskMirror?: string;
  },
): { under: HTMLElement[]; over: HTMLElement[] } {
  const { config, sideFlash } = ctx;
  const motion = config.motion;
  // `lights` and sideFlash need the full ring: their JS gradient already paints
  // the correct pattern everywhere, so every layer shows the whole border once.
  // Only the original CSS-conic flash keeps half-ring + mirror.
  const cov: Coverage | undefined = o.moving || sideFlash ? "full" : undefined;
  const wm = sideFlash ? undefined : o.flashWindowMask;
  const wmM = sideFlash ? undefined : o.flashWindowMaskMirror;
  // Border: no mirror for sideFlash (the --iris-grad already paints the full
  // ring; doubling the 1px border makes it too bright). Glow layers: mirror only
  // the CSS-conic flash - a mirrored sideFlash copy would paint a REFLECTED
  // ghost of the flash whenever origin/dest aren't symmetric across the axis.
  const borderMirror = motion.mode === "flash" && config.symmetric && !sideFlash;
  const glowMirror = motion.mode === "flash" && config.symmetric && !sideFlash;
  const showInner = config.glowReach === "inner" || config.glowReach === "both";
  const showOuter = config.glowReach === "outer" || config.glowReach === "both";

  const over: HTMLElement[] = [];
  const under: HTMLElement[] = [];

  if (config.borderEnabled) {
    over.push(borderSide(ctx, { windowMask: wm }));
    if (borderMirror) over.push(borderSide(ctx, { mirror: true, windowMask: wmM }));
    // The original flash paints the border ring TWICE (main + mirror overlay).
    // The unmirrored sideFlash doubles it to keep the same ring saturation.
    if (sideFlash) over.push(borderSide(ctx, {}));
  }
  if (showInner) {
    over.push(maskedGlowSide(ctx, { coverage: cov, windowMask: wm }));
    if (glowMirror) over.push(maskedGlowSide(ctx, { mirror: true, coverage: cov, windowMask: wmM }));
  }
  if (showOuter) {
    // sideFlash has no mirrored copy, so its extra richness layers (3 + 2) ride
    // on the single full-ring pass instead.
    under.push(outerGlowSide(ctx, { extra: sideFlash, coverage: cov, windowMask: wm }));
    if (glowMirror) under.push(outerGlowSide(ctx, { mirror: true, extra: true, coverage: cov, windowMask: wmM }));
  }
  return { under, over };
}
