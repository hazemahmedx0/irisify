import type { IrisifyPaletteName } from "./palettes";

// ─── Colour ───────────────────────────────────────────────────────────────────

/** A rainbow stop in OKLCH (the engine's native colour space). */
export type OklchStop = { l: number; c: number; h: number; a: number };

/** Authored conic stop angles of the flash wedge (degrees from its head). */
export type StopAngles = {
  stop2: number;
  stop3: number;
  stop4: number;
  stop5: number;
  stop6: number;
  stop7: number;
};

// ─── Procedural masks ─────────────────────────────────────────────────────────

export type MaskIndex = 1 | 2 | 3 | 4 | 5 | 6;

export type StrokeAlign = "inside" | "outside" | "center";

/**
 * One simple primitive reproduces every glow mask: a rounded-rect ("pill") -
 * either filled or an outline ring - positioned on the card, optionally CROPPED
 * at a vertical axis (the mirror centre), then BLURRED.
 * All geometry is CARD-RELATIVE: w/h/cx/cy are fractions of the card,
 * radius ≤ 1 is a fraction of the card's corner radius (1 = match the card),
 * radius > 1 is literal px. line/blur are literal px at any card size.
 */
export type ProceduralMaskSpec = {
  shape: "fill" | "outline";
  w: number; // pill width  ÷ card width
  h: number; // pill height ÷ card height
  cx: number; // pill centre x ÷ card width  (0.5 = card centre)
  cy: number; // pill centre y ÷ card height (0.5 = card centre)
  radius: number; // ≤1: fraction of card corner radius · >1: literal px
  rotate?: number; // rotation in degrees around the pill centre
  gradAngle?: number; // directional fade, CSS convention (90 = left→right, 0 = bottom→top)
  line: number; // outline thickness, px
  blur: number; // px
  opacity: number; // 0–1
  cropLeft: number; // crop fraction off the left; 0 = no crop, 0.5 = right half
  strokeAlign?: StrokeAlign;
};

/** An inner glow pass: which mask shape it uses + its own blur/opacity/size. */
export type GlowLayer = {
  id: string;
  mask: MaskIndex;
  blur: number; // px
  opacity: number; // 0–1
  layerW: number | null; // px - null means "match element width"
  layerH: number | null; // px - null means "match element height"
  enabled: boolean;
};

// ─── Motion model ─────────────────────────────────────────────────────────────
// Two modes:
//   • flash  - the original: a coloured wedge fades in/out, travelling from an
//     origin point on the border to a destination point.
//   • lights - a unified, fully-orthogonal engine. A "light" is a band of colour
//     sitting on the border. You choose WHERE (any set of sides, or a custom
//     arc), WHAT (one continuous chain, or N discrete bands of a given width),
//     and HOW it behaves (travel / pulse / static / reveal). All combinations
//     are reachable.

export type MotionMode = "flash" | "lights";
export type Repeat = "loop" | "once";
export type GlowReach = "inner" | "outer" | "both";
export type Side = "top" | "right" | "bottom" | "left";

/** `chain` - colours fill the lit arc as one continuous rainbow.
 *  `bands` - N discrete light bands of a set width, evenly spaced (with gaps). */
export type LightFill = "chain" | "bands";

/** `travel` - lights move along the arc. `static` - sit still. (Pulse is a
 *  separate toggle that composes with either.) */
export type LightMove = "travel" | "static";

/** band width unit - `arc`: % of the lit arc · `border`: % of the whole border ·
 *  `px`: absolute border length in px. */
export type WidthUnit = "arc" | "border" | "px";

export interface MotionSpec {
  mode: MotionMode;

  // ── placement ──
  /** Lit sides. Empty → the whole border. Ignored when `useCustomArc`. */
  sides: Side[];
  /** Use an exact arc (startAngle + sweep) instead of side selection. */
  useCustomArc: boolean;
  /** Custom-arc PLACEMENT start, degrees, 0 = top-centre, +clockwise. */
  startAngle: number;
  /** Custom-arc PLACEMENT sweep, degrees (+cw). */
  sweep: number;
  /** Flash rotation origin, degrees (where the sweep begins). Independent of
   *  placement so a custom-arc window never spins the flash. 180 = bottom (original). */
  flashStart: number;
  /** Flash rotation amount, degrees. −150 = the original gentle bottom→top sweep. */
  flashSweep: number;
  /** Flash engine override. `vertical` (default) = the pure-CSS conic, used only
   *  for the canonical bottom→top flash. `horizontal` forces the JS two-arm
   *  gradient. You rarely need to set this: any non-default `flashOriginAngle` /
   *  `flashDestAngle` already routes through the JS path automatically. */
  flashAxis: "vertical" | "horizontal";
  /** Flash origin - the point on the border where the two arms start, 0=top CW.
   *  Default 180 (bottom-centre). Setting this to anything else automatically
   *  switches to the JS engine, so the direction takes effect on its own. */
  flashOriginAngle: number;
  /** Flash destination - the point where both arms converge, 0=top CW. Default 0
   *  (top-centre). Any non-default value auto-activates the JS engine. */
  flashDestAngle: number;
  /** How far past the original's stop-short point each arm's band head travels
   *  (0–0.5). 0 = the original convergence - the head stops 150/180 of the way
   *  and only the wedge's luminous lead reaches the destination as the fade
   *  completes; 0.5 = the head itself lands exactly ON the destination, closing
   *  earlier and brighter. */
  flashOverlap: number;
  /** Stay lit: the flash travels origin → destination, then instead of fading the
   *  whole path STAYS glowing with the colours flowing through it. Dismissed via
   *  the `flashDismiss` option (the tail lifts off the origin, sweeps to the
   *  destination and the glow melts away there). */
  flashHold: boolean;
  /** Length of the trail behind each arm's head, as a fraction of that arm
   *  (0.1–1). Default 0.4 = the original wedge's 72°/180° trailing span. The
   *  colour profile stretches with it, so a long trail is a long rainbow. */
  flashTrail?: number;
  /** Extra brightness falloff along the trail, 0–1. 0 = the original wedge
   *  (full brightness until the authored fade near the trail end); 1 = the
   *  trail dims steeply behind the head - a comet rather than a ribbon. */
  flashTrailFade?: number;

  // ── appearance ──
  fill: LightFill;
  /** Number of bands (fill = bands). */
  count: number;
  /** Band width value, interpreted per `widthUnit`. */
  width: number;
  widthUnit: WidthUnit;
  /** End softness, 0 (razor sharp) → 0.5 (soft gradient fade). */
  feather: number;

  // ── behaviour ──
  move: LightMove;
  /** Come & go - fade in/out (with a gap = dark rest). Composes with travel/static. */
  pulse: boolean;
  /** Draw-on flash: the lit arc sweeps on from the start around the placement as ONE
   *  continuous piece, then flashes off (gap = rest). */
  reveal: boolean;
  /** Travel direction: +1 clockwise, −1 counter-clockwise. */
  direction: 1 | -1;
  /** travel: `loop` forever / `once` then fade out. */
  repeat: Repeat;
}

// ─── Advanced (level-2) options - the full engine surface ─────────────────────

export interface IrisifyAdvanced {
  /** Full motion spec (merged over the preset's). */
  motion?: Partial<MotionSpec>;
  /** Rainbow stops in OKLCH. (Level-1 `colors` is the CSS-string shorthand.) */
  stops?: OklchStop[];
  /** Authored conic stop angles of the flash wedge. */
  stopAngles?: StopAngles;
  /** Seconds per animation cycle. */
  duration?: number;
  /** CSS timing function (keyword or cubic-bezier) driving the flash. */
  easing?: string;
  /** Keyframe % when the flash reaches full opacity (default 10). */
  fadeInAt?: number;
  /** Keyframe % when the flash starts fading (default 30). */
  visibleUntil?: number;
  /** Seconds of darkness between cycles. Negative (flash only): the next flight
   *  launches while the previous tail still fades. */
  gapBetween?: number;
  /** Inner glow passes (mask + blur + opacity each). */
  innerLayers?: GlowLayer[];
  /** Mask shape of the outer halo (default 1 - the big soft blob). */
  outerGlowMask?: MaskIndex;
  /** Extra blur on the outer halo, px (default 4). */
  outerGlowBlur?: number;
  /** Outer halo opacity 0–1 (default 1). */
  outerGlowOpacity?: number;
  /** Crisp 1px border ring (default true). */
  borderEnabled?: boolean;
  /** Override the built-in mask shapes per index. */
  proceduralSpecs?: Partial<Record<MaskIndex, ProceduralMaskSpec>>;
  /** Mirror the flash left↔right (two symmetric beams). Default true. */
  symmetric?: boolean;
  /** Render the inner masked glow, the outer halo, or both. Default both. */
  glowReach?: GlowReach;
  /** With `motion.flashHold`: flip to true to dismiss the held glow. */
  flashDismiss?: boolean;
}

// ─── Level-1 (simple) options ─────────────────────────────────────────────────

export type IrisifyPreset =
  | "flash" // the original: rainbow wedge flashing bottom → top
  | "hold" // flash in, then stay lit with flowing colours (dismissable)
  | "beam" // one comet band travelling the border
  | "rainbow" // the full rainbow flowing around the border
  | "pulse" // the lit border breathing in and out
  | "glow" // a static lit rainbow border (no animation loop)
  | "reveal"; // the border draws itself on, flashes off, repeats

export type IrisifyPlacement = "all" | Side[] | { start: number; sweep: number };

export interface IrisifyOptions {
  // ── level 1: simple ──
  /** What the light does. Default `"flash"` (the original). */
  preset?: IrisifyPreset;
  /** The gradient: a built-in palette name (`"iris"`, `"aurora"`, `"ocean"`,
   *  `"sunset"`, `"candy"`, `"ember"`, `"neon"`, `"mono"`) or your own CSS
   *  colour strings (hex / rgb / hsl / oklch), in order. Flowing modes sample
   *  the list cyclically - the last colour blends back into the first. */
  colors?: string[] | IrisifyPaletteName;
  /** Seconds per cycle (one flash, one lap, one breath…). */
  speed?: number;
  /** Where the glow blooms relative to the border. Default `"both"`. */
  glow?: "inside" | "outside" | "both";
  /** Overall glow strength, 0–2 (1 = the original). Scales halo + inner glow. */
  intensity?: number;
  /** Crisp 1px rainbow ring on the border itself. Default `true`. */
  border?: boolean;
  /** Which part of the border is lit: `"all"`, a list of sides, or an exact
   *  arc `{ start, sweep }` in degrees (0 = top-centre, clockwise). */
  placement?: IrisifyPlacement;
  /** Travel direction for moving presets. Default `"clockwise"`. */
  direction?: "clockwise" | "counterclockwise";
  /** Seconds of rest between cycles. Negative (flash/hold): overlap flights. */
  gap?: number;
  /** Freeze the animation (keeps the current frame). */
  paused?: boolean;
  /** For `preset: "hold"`: flip to true to dismiss the held glow. */
  dismissed?: boolean;
  /** Corner radius override in px. Default: read from the element's CSS. */
  radius?: number;
  /** z-index of the OVER overlay (border + inner glow). Default: none set. */
  zIndex?: number;
  /** `prefers-reduced-motion` behaviour:
   *  `"static"` (default) - replace motion with a still lit border,
   *  `"none"` - render nothing, `"ignore"` - animate anyway. */
  reducedMotion?: "static" | "none" | "ignore";
  /** Master switch. `false` removes the effect entirely (no DOM, no work) while
   *  keeping the instance alive - flip back to `true` to bring it back.
   *  Perfect for "glow only while loading" states. Default `true`. */
  enabled?: boolean;

  // ── level 2: everything ──
  /** Full engine control. Anything set here wins over the simple options. */
  advanced?: IrisifyAdvanced;
}

// ─── Instance ─────────────────────────────────────────────────────────────────

export interface IrisifyInstance {
  /** Merge new options in and re-render. */
  update(options: IrisifyOptions): void;
  /** Replace all options and re-render. Useful for controlled integrations. */
  setOptions(options: IrisifyOptions): void;
  /** Freeze on the current frame. */
  pause(): void;
  /** Resume. */
  play(): void;
  /** `hold` preset: sweep the held glow away. */
  dismiss(): void;
  /** `hold` preset: play the glow back in. */
  show(): void;
  /** Re-measure the element (size/radius) and re-render. */
  refresh(): void;
  /** Remove all overlay DOM, styles and observers. */
  destroy(): void;
  /** The element the effect is attached to. */
  readonly element: HTMLElement;
}
