import type {
  GlowLayer,
  GlowReach,
  IrisifyOptions,
  IrisifyPreset,
  MaskIndex,
  MotionSpec,
  OklchStop,
  ProceduralMaskSpec,
  StopAngles,
} from "./types";
import {
  DEFAULT_INNER_LAYERS,
  DEFAULT_INPUTS,
  DEFAULT_MOTION,
  DEFAULT_STOP_ANGLES,
  DEFAULT_STOPS,
} from "./defaults";
import { parseColor } from "./core/color";
import { IRISIFY_PALETTES } from "./palettes";

/** Everything the renderer needs, fully resolved (defaults → preset → simple →
 *  advanced, later wins). */
export type ResolvedConfig = {
  motion: MotionSpec;
  stops: OklchStop[];
  stopAngles: StopAngles;
  duration: number;
  easing: string;
  fadeInAt: number;
  visibleUntil: number;
  gapBetween: number;
  innerLayers: GlowLayer[];
  outerGlowMask: MaskIndex;
  outerGlowBlur: number;
  outerGlowOpacity: number;
  borderEnabled: boolean;
  proceduralSpecs?: Partial<Record<MaskIndex, ProceduralMaskSpec>>;
  symmetric: boolean;
  glowReach: GlowReach;
  flashDismiss: boolean;
  paused: boolean;
  zIndex?: number;
  radiusOverride?: number;
  /** reducedMotion: "none" → render nothing at all. */
  disabled: boolean;
};

// ─── Level-1 presets - each is just a starting point on the full surface ──────

/** What each preset actually sets. Exported so you can inspect a preset and
 *  build your own config on top of it (everything here is plain data). */
export const IRISIFY_PRESETS: Record<
  IrisifyPreset,
  { motion?: Partial<MotionSpec>; duration?: number; gapBetween?: number }
> = {
  // the original: rainbow wedge flashing bottom → top, mirrored beams
  flash: { motion: { mode: "flash" }, duration: 1 },
  // flash in, then stay lit with the colours flowing (dismiss via `dismissed`)
  hold: { motion: { mode: "flash", flashHold: true }, duration: 1 },
  // one comet band travelling the border
  beam: {
    motion: { mode: "lights", fill: "bands", count: 1, width: 18, widthUnit: "border", move: "travel", feather: 0.3 },
    duration: 6,
  },
  // the full rainbow flowing around the border
  rainbow: {
    motion: { mode: "lights", fill: "chain", width: 100, widthUnit: "arc", move: "travel" },
    duration: 8,
  },
  // the lit border breathing in and out
  pulse: {
    motion: { mode: "lights", fill: "chain", width: 100, widthUnit: "arc", move: "static", pulse: true },
    duration: 2.4,
    gapBetween: 0.5,
  },
  // a static lit rainbow border - no animation loop at all
  glow: {
    motion: { mode: "lights", fill: "chain", width: 100, widthUnit: "arc", move: "static" },
  },
  // the border draws itself on, flashes off, repeats
  reveal: {
    motion: { mode: "lights", fill: "chain", width: 100, widthUnit: "arc", move: "travel", reveal: true },
    duration: 1.6,
    gapBetween: 1,
  },
};

export function resolveConfig(
  options: IrisifyOptions,
  env: { reducedMotion: boolean },
): ResolvedConfig {
  const preset = IRISIFY_PRESETS[options.preset ?? "flash"] ?? IRISIFY_PRESETS.flash;
  const adv = options.advanced ?? {};

  // motion: defaults → preset → simple mappings → advanced
  const motion: MotionSpec = { ...DEFAULT_MOTION, ...preset.motion };

  if (options.placement && options.placement !== "all") {
    if (Array.isArray(options.placement)) {
      motion.sides = options.placement;
      motion.useCustomArc = false;
    } else {
      motion.useCustomArc = true;
      motion.startAngle = options.placement.start;
      motion.sweep = options.placement.sweep;
    }
  }
  if (options.direction) motion.direction = options.direction === "counterclockwise" ? -1 : 1;
  Object.assign(motion, adv.motion);

  // colours: palette name or CSS strings → OKLCH; advanced stops win
  let stops = DEFAULT_STOPS;
  const colorList =
    typeof options.colors === "string"
      ? (IRISIFY_PALETTES[options.colors] as readonly string[] | undefined)
      : options.colors;
  if (colorList?.length) {
    const parsed = colorList.map(parseColor).filter((s): s is OklchStop => s !== null);
    if (parsed.length >= 2) stops = parsed;
    else if (parsed.length === 1) stops = [parsed[0], parsed[0]];
  }
  if (adv.stops?.length) stops = adv.stops;

  const intensity = Math.max(0, options.intensity ?? 1);
  const innerLayers = (adv.innerLayers ?? DEFAULT_INNER_LAYERS).map((l) => ({
    ...l,
    opacity: adv.innerLayers ? l.opacity : Math.min(1, l.opacity * intensity),
  }));

  const cfg: ResolvedConfig = {
    motion,
    stops,
    stopAngles: adv.stopAngles ?? DEFAULT_STOP_ANGLES,
    duration: adv.duration ?? options.speed ?? preset.duration ?? DEFAULT_INPUTS.duration,
    easing: adv.easing ?? DEFAULT_INPUTS.easing,
    fadeInAt: adv.fadeInAt ?? DEFAULT_INPUTS.fadeInAt,
    visibleUntil: adv.visibleUntil ?? DEFAULT_INPUTS.visibleUntil,
    gapBetween: adv.gapBetween ?? options.gap ?? preset.gapBetween ?? DEFAULT_INPUTS.gapBetween,
    innerLayers,
    outerGlowMask: adv.outerGlowMask ?? DEFAULT_INPUTS.outerGlowMask,
    outerGlowBlur: adv.outerGlowBlur ?? DEFAULT_INPUTS.outerGlowBlur,
    outerGlowOpacity:
      adv.outerGlowOpacity ?? Math.min(2, DEFAULT_INPUTS.outerGlowOpacity * intensity),
    borderEnabled: adv.borderEnabled ?? options.border ?? DEFAULT_INPUTS.borderEnabled,
    proceduralSpecs: adv.proceduralSpecs,
    symmetric: adv.symmetric ?? DEFAULT_INPUTS.symmetric,
    glowReach:
      adv.glowReach ??
      (options.glow === "inside" ? "inner" : options.glow === "outside" ? "outer" : options.glow) ??
      DEFAULT_INPUTS.glowReach,
    flashDismiss: adv.flashDismiss ?? options.dismissed ?? DEFAULT_INPUTS.flashDismiss,
    paused: options.paused ?? DEFAULT_INPUTS.paused,
    zIndex: options.zIndex,
    radiusOverride: options.radius,
    disabled: false,
  };

  // master switch: render nothing while keeping the instance alive
  if (options.enabled === false) cfg.disabled = true;

  // prefers-reduced-motion: decorative motion downgraded, not just stopped.
  const rm = options.reducedMotion ?? "static";
  if (env.reducedMotion && rm !== "ignore") {
    if (rm === "none") cfg.disabled = true;
    else {
      // a still, lit border - keeps the colour identity without any movement
      cfg.motion = {
        ...cfg.motion,
        mode: "lights",
        fill: "chain",
        width: 100,
        widthUnit: "arc",
        move: "static",
        pulse: false,
        reveal: false,
        flashHold: false,
      };
      cfg.paused = false;
    }
  }
  return cfg;
}
