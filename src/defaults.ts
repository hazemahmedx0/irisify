import type {
  GlowLayer,
  MaskIndex,
  MotionSpec,
  OklchStop,
  ProceduralMaskSpec,
  StopAngles,
} from "./types";

/** The signature irisify rainbow (the default `iris` palette). */
export const DEFAULT_STOPS: OklchStop[] = [
  { l: 0.452, c: 0.249, h: 264.1, a: 1.0 }, // #005bf6  blue
  { l: 0.797, c: 0.052, h: 228.7, a: 1.0 }, // #b0c6e9  light blue
  { l: 0.843, c: 0.195, h: 87.0, a: 1.0 }, // #feca00  yellow
  { l: 0.628, c: 0.258, h: 27.4, a: 1.0 }, // #ff1c11  red
  { l: 0.7, c: 0.322, h: 316.0, a: 1.0 }, // #ff00ea  magenta
  { l: 0.782, c: 0.161, h: 319.8, a: 0.8 }, // #ffa2fb  pink (80 % α)
  { l: 0.778, c: 0.102, h: 249.2, a: 0.631 }, // #95c1ff  arc blue (63 % α)
];

export const DEFAULT_STOP_ANGLES: StopAngles = {
  stop2: 16,
  stop3: 30,
  stop4: 43,
  stop5: 59,
  stop6: 72,
  stop7: 84,
};

/** Stop angles the flash wedge widens to as it fades out (the original keyframe). */
export const RESET_STOP_ANGLES = [6, 11, 17, 40, 90, 120];

export const DEFAULT_MOTION: MotionSpec = {
  mode: "flash",
  sides: ["top", "right", "bottom", "left"],
  useCustomArc: false,
  startAngle: 0, // custom-arc placement default = full
  sweep: 360,
  flashStart: 180, // flash rotation: original 180° → 30°
  flashSweep: -150,
  flashAxis: "vertical",
  flashOriginAngle: 180, // bottom-centre
  flashDestAngle: 0, // top-centre
  flashOverlap: 0.12,
  flashHold: false,
  flashTrail: 0.4,
  flashTrailFade: 0,
  fill: "chain",
  count: 3,
  width: 100, // chain fills by default; lower it for a sized segment / bands
  widthUnit: "arc",
  feather: 0.3,
  move: "travel",
  pulse: false,
  reveal: false,
  direction: 1,
  repeat: "loop",
};

// layerW/layerH null = auto (matches element size at render time)
export const DEFAULT_INNER_LAYERS: GlowLayer[] = [
  { id: "il1", mask: 6, blur: 0, opacity: 1, layerW: null, layerH: null, enabled: true },
  { id: "il2", mask: 3, blur: 0, opacity: 1, layerW: null, layerH: null, enabled: true },
  { id: "il3", mask: 2, blur: 0, opacity: 1, layerW: null, layerH: null, enabled: true },
];

export const PROCEDURAL_MASK_SPECS: Record<MaskIndex, ProceduralMaskSpec> = {
  // All geometry is CARD-RELATIVE: w/h are fractions of the card (1 = full card),
  // cx/cy fractions of the card, radius a fraction of the card's corner radius
  // (1 = match), cropLeft a fraction of card width (0.5 = centre axis). line/blur
  // are literal px at any card size.
  // large soft FILLED blob, heavy blur - right of centre
  1: { shape: "fill", w: 0.5, h: 1.2, cx: 0.75, cy: 0.5, radius: 1, line: 0, blur: 15, opacity: 0.155, cropLeft: 0, strokeAlign: "inside" },
  // top + bottom soft bars + right cap = card-border ring, right half, med blur
  2: { shape: "outline", w: 1, h: 1, cx: 0.5, cy: 0.5, radius: 1, line: 7, blur: 8, opacity: 0.08, cropLeft: 0.5, strokeAlign: "inside" },
  // thinner / sharper version of mask 2
  3: { shape: "outline", w: 1, h: 1, cx: 0.5, cy: 0.5, radius: 1, line: 4, blur: 5, opacity: 0.11, cropLeft: 0.5, strokeAlign: "inside" },
  // SOLID chunk, no blur - right half of the card
  4: { shape: "fill", w: 1, h: 1, cx: 0.5, cy: 0.5, radius: 1, line: 0, blur: 0, opacity: 1, cropLeft: 0.5, strokeAlign: "inside" },
  // full crisp card-border OUTLINE, barely blurred
  5: { shape: "outline", w: 1, h: 1, cx: 0.5, cy: 0.5, radius: 1, line: 3, blur: 4, opacity: 0.86, cropLeft: 0, strokeAlign: "inside" },
  // thin crisp top + bottom + right cap
  6: { shape: "outline", w: 1, h: 1, cx: 0.5, cy: 0.5, radius: 1, line: 3, blur: 3, opacity: 0.135, cropLeft: 0.5, strokeAlign: "inside" },
};

export const DEFAULT_INPUTS = {
  duration: 1,
  easing: "cubic-bezier(0.26, 0.94, 0.6, 1)",
  fadeInAt: 10, // keyframe % when glow reaches full opacity
  visibleUntil: 30, // keyframe % when glow starts fading
  gapBetween: 0, // seconds of darkness between cycles
  outerGlowMask: 1 as MaskIndex,
  // The flash's outer halo is now a border-hugging ring (see flashHalo in
  // layers.ts), so its width lives in that spec's blur - this stays at the modest
  // baseline so the FILL-based halos (lights / sideFlash) aren't over-widened into
  // their own leak. Fully overridable: advanced.outerGlowBlur adds spread on top,
  // advanced.outerGlowOpacity / the simple `intensity` knob set how bright it reads.
  outerGlowBlur: 4,
  outerGlowOpacity: 1,
  borderEnabled: true,
  symmetric: true,
  glowReach: "both" as const,
  flashDismiss: false,
  paused: false,
};
