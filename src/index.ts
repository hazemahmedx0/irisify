// irisify - iridescent border glow for any element.
// Level 1: pick a preset and a few knobs. Level 2: `advanced` exposes the whole
// engine. Lower-level builders are exported too, for people who want to drive
// the gradient themselves.

export { irisify } from "./dom/attach";
export { createController, mergeOptions, type Controller, type ControllerSetup } from "./dom/controller";
export { IRISIFY_PRESETS, resolveConfig, type ResolvedConfig } from "./resolve";
export { IRISIFY_PALETTES, type IrisifyPaletteName } from "./palettes";

export type {
  GlowLayer,
  GlowReach,
  IrisifyAdvanced,
  IrisifyInstance,
  IrisifyOptions,
  IrisifyPlacement,
  IrisifyPreset,
  LightFill,
  LightMove,
  MaskIndex,
  MotionMode,
  MotionSpec,
  OklchStop,
  ProceduralMaskSpec,
  Repeat,
  Side,
  StopAngles,
  StrokeAlign,
  WidthUnit,
} from "./types";

export {
  DEFAULT_INNER_LAYERS,
  DEFAULT_MOTION,
  DEFAULT_STOP_ANGLES,
  DEFAULT_STOPS,
  PROCEDURAL_MASK_SPECS,
} from "./defaults";

// ── Low-level engine (advanced/custom integrations) ──
export {
  angleAtFrac,
  fracAtAngle,
  makePerimeterMap,
  sidesToArcs,
  type PerimeterMap,
} from "./core/geometry";
export {
  buildMovingGradient,
  buildWindowMaskConic,
  type LightArc,
  type MovingGradientParams,
} from "./core/gradient";
export { buildMaskSvgUrl, resolvePillGeometry } from "./core/masks";
export { parseColor, sampleRainbow, stopCss } from "./core/color";
export { easingToFn } from "./core/easing";
