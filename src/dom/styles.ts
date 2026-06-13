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
  overflow: visible;
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

  // flash - original behaviour: a coloured conic wedge fades in/out with a slight
  // rotation, stop angles widening as it fades.
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
  const gradient = [
    "var(--iris-c0) 0deg",
    ...midParts,
    `transparent var(--iris-stop-${n}) 324deg`,
    `var(--iris-c${n - 1}) 349deg`,
    "var(--iris-c0) 360deg",
  ].join(",\n        ");

  const start = motion.flashStart;
  const end = motion.flashStart + motion.flashSweep;

  return `
    @keyframes ${kf} {
      0% { opacity: 0; --iris-deg: ${start}deg; }
      ${p(fadeInAt)}%, ${p(visibleUntil)}% { opacity: 1; }
      ${endPct}%, 100% {
        opacity: 0;
        --iris-deg: ${end}deg;
        ${resetAngles};
      }
    }
    .iris-grad.${cls}::before {
      ${angleDecls};
      background: conic-gradient(
        in srgb from var(--iris-deg) at 50% 50%,
        ${gradient}
      );
    }
    .iris-grad.${cls}[data-playing="true"]::before {
      animation: ${total}s ${easing} ${kf} infinite;
      animation-play-state: var(--iris-play, running);
    }
  `;
}
