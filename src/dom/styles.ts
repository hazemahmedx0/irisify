import type { MotionSpec, StopAngles } from "../types";
import { RESET_STOP_ANGLES } from "../defaults";

// ─── Base stylesheet (injected once per document) ─────────────────────────────

const BASE_STYLE_ID = "irisify-base";

// @property registrations make the flash keyframe's custom-property animation
// interpolate smoothly (an unregistered property would snap). Duplicate
// registrations from a second copy of the library are silently ignored.
const stopProps = [16, 30, 43, 59, 72, 84]
  .map(
    (v, i) => `@property --iris-stop-${i + 2} {
  syntax: "<angle>";
  inherits: false;
  initial-value: ${v}deg;
}`,
  )
  .join("\n");

export const BASE_CSS = `@property --iris-deg {
  syntax: "<angle>";
  inherits: false;
  initial-value: 180deg;
}
${stopProps}
.iris-grad {
  /* The CSS-flash conic ::before is oversized to a square bigger than the box
     diagonal so a transform-rotate sweep never uncovers a corner. CLIP that
     excess here: it is always masked-out (every .iris-grad is confined to a
     ring/glow shape inside its own box), so clipping is visually a no-op - but
     leaving it visible leaked a ~hypot(w,h)px decorative box into the document's
     scrollable area. That was enough to toggle a scrollbar, which fed the
     ResizeObserver -> re-render loop: the page height oscillated and the glows
     flashed as every layer was torn down and rebuilt each frame. */
  overflow: hidden;
  /* Safari/WebKit: the JS driver rewrites --iris-grad every frame, but during
     the rest gap between flashes the painted conic is identical (fully
     transparent) for many frames. WebKit treats the masked gradient layer as
     static, evicts its backing store, then re-rasterizes a STALE frame for one
     tick when the next flight resumes - a full-ring flash that the gradient
     value never actually contains. Pinning each painter to its own stable
     compositing layer keeps the backing store alive across the gap, so the
     re-raster never happens. (Chrome's compositor doesn't evict here, so this
     is a no-op there.) */
  transform: translateZ(0);
  -webkit-backface-visibility: hidden;
  backface-visibility: hidden;
}
.iris-grad::before {
  content: "";
  opacity: 0;
  width: 100%;
  height: 100%;
  position: absolute;
  top: 0;
  left: 0;
  border-radius: inherit;
}
.iris-overlay {
  position: absolute;
  inset: 0;
  pointer-events: none;
}
.iris-mask-core {
  -webkit-mask-image: radial-gradient(25% 70% at 50% 100%, transparent 25%, #000 100%);
  mask-image: radial-gradient(25% 70% at 50% 100%, transparent 25%, #000 100%);
}
.iris-mask-border .iris-mask-core {
  -webkit-mask-image: none;
  mask-image: none;
}
.iris-mask-border {
  pointer-events: none;
  -webkit-mask-image: linear-gradient(#fff 0 0), linear-gradient(#fff 0 0);
  mask-image: linear-gradient(#fff 0 0), linear-gradient(#fff 0 0);
  -webkit-mask-position: 0 0, 0 0;
  mask-position: 0 0, 0 0;
  -webkit-mask-size: auto, auto;
  mask-size: auto, auto;
  -webkit-mask-repeat: repeat, repeat;
  mask-repeat: repeat, repeat;
  -webkit-mask-clip: content-box, border-box;
  mask-clip: content-box, border-box;
  -webkit-mask-origin: content-box, border-box;
  mask-origin: content-box, border-box;
  -webkit-mask-composite: xor;
  mask-composite: exclude;
}
`;

export function ensureBaseStyles(doc: Document): void {
  if (doc.getElementById(BASE_STYLE_ID)) return;
  const style = doc.createElement("style");
  style.id = BASE_STYLE_ID;
  style.textContent = BASE_CSS;
  doc.head.appendChild(style);
}

// ─── Per-instance dynamic styles ──────────────────────────────────────────────

const ANGLE_KEYS: (keyof StopAngles)[] = ["stop2", "stop3", "stop4", "stop5", "stop6", "stop7"];

export function buildStyles(
  cls: string,
  stopCount: number,
  duration: number,
  gapBetween: number,
  easing: string,
  angles: StopAngles,
  fadeInAt: number,
  visibleUntil: number,
  motion: MotionSpec,
  useJsGradient: boolean,
): string {
  const kf = `iris-anim-${cls}`;
  // CSS keyframes can't overlap themselves - a negative gap routes to the JS
  // path; clamp here so the CSS path degrades to gap 0.
  const total = duration + Math.max(0, gapBetween);
  const ratio = duration / total;
  const p = (pct: number) => (pct * ratio).toFixed(2);
  const endPct = (ratio * 100).toFixed(2);
  const n = stopCount;

  // `lights` / sideFlash are driven by a JS rAF loop that rewrites the
  // `--iris-grad` custom property (a perimeter-mapped conic). The ::before just
  // paints that variable at full opacity - no CSS keyframe, no angular rotation.
  if (useJsGradient) {
    return `
    .iris-grad.${cls}::before {
      opacity: 1;
      background: var(--iris-grad, transparent);
      animation: none;
    }
    .iris-grad.${cls}.iris-lo::before {
      background: var(--iris-grad-lo, var(--iris-grad, transparent));
    }
  `;
  }

  // flash - a coloured conic wedge fades in/out while it sweeps from origin to
  // destination. The sweep is a `transform: rotate` on the conic layer
  // (GPU-composited), NOT an animated @property `from` angle: that registered-
  // @property animation made Safari/WebKit paint a full-ring frame for one tick
  // at every `animation: infinite` restart. The `from` angle is fixed; only
  // transform + opacity + the stop angles animate.
  //
  // The wedge's trailing END must FADE, not stop solid: its conic stop angles
  // start tight (`angleDecls`, the base value on ::before) and widen toward
  // RESET_STOP_ANGLES across the cycle, spreading the colour out until it
  // dissolves as opacity reaches 0. Dropping this (it was lost in the rotate
  // rework) left a hard solid end. The widening rides ALONGSIDE the transform -
  // the two are independent (rotation places the wedge, the stops shape it).
  const resetAngles = RESET_STOP_ANGLES.slice(0, n - 1)
    .map((v, i) => `--iris-stop-${i + 2}: ${v}deg`)
    .join("; ");
  const angleDecls = ANGLE_KEYS.slice(0, n - 1)
    .map((k, i) => `--iris-stop-${i + 2}: ${angles[k]}deg`)
    .join(";\n      ");
  const midParts = Array.from(
    { length: n - 2 },
    (_, i) => `var(--iris-c${i + 1}) var(--iris-stop-${i + 2})`,
  );
  // Trailing taper: the last colour (stop n-1) fades to transparent. Pushing the
  // transparent stop well PAST stop-n stretches that fade over a long, smooth
  // span instead of an abrupt ~12° cut - the comet tail dissolves gently. The
  // offset rides on the @property var, so the fade still widens further on
  // fade-out (resetAngles). Leading edge (c0 at 0°) gets a matching long ramp in
  // from the transparent gap so both ends of the lit arc taper, not just one.
  const TAIL = 34; // extra degrees of trailing fade beyond stop-n
  const gradient = [
    "var(--iris-c0) 0deg",
    ...midParts,
    `transparent calc(var(--iris-stop-${n}) + ${TAIL}deg) 312deg`,
    `var(--iris-c${n - 1}) 344deg`,
    "var(--iris-c0) 360deg",
  ].join(",\n        ");

  const start = motion.flashStart;
  const end = motion.flashStart + motion.flashSweep;
  // The wedge sweeps by rotating the conic layer from 0 to (end−start)°. The
  // conic is a fixed `from ${start}deg`, so rotate(end−start) lands it exactly
  // where the old animated `--iris-deg: ${end}deg` did.
  const rot = (end - start).toFixed(2);

  return `
    @keyframes ${kf} {
      0% { opacity: 0; transform: rotate(0deg); }
      ${p(fadeInAt)}%, ${p(visibleUntil)}% { opacity: 1; }
      ${endPct}%, 100% {
        opacity: 0;
        transform: rotate(${rot}deg);
        ${resetAngles};
      }
    }
    .iris-grad.${cls}::before {
      ${angleDecls};
      width: var(--iris-diag, 200%);
      height: var(--iris-diag, 200%);
      left: calc(50% - var(--iris-diag, 200%) / 2);
      top: calc(50% - var(--iris-diag, 200%) / 2);
      transform-origin: 50% 50%;
      background: conic-gradient(
        in srgb from ${start}deg at 50% 50%,
        ${gradient}
      );
    }
    .iris-grad.${cls}[data-playing="true"]::before {
      animation: ${total}s ${easing} ${kf} infinite;
      animation-play-state: var(--iris-play, running);
    }
  `;
}
