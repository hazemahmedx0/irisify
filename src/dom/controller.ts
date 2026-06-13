import type { IrisifyOptions } from "../types";
import { resolveConfig, type ResolvedConfig } from "../resolve";
import { fracAtAngle, makePerimeterMap, sidesToArcs } from "../core/geometry";
import { buildWindowMaskConic, SIDE_FLASH_BAND, type LightArc } from "../core/gradient";
import { startDriver, type GradArgs } from "../core/driver";
import { stopCss } from "../core/color";
import { buildLayers } from "./layers";
import { buildStyles, ensureBaseStyles } from "./styles";

// Unique per-instance class. The random module prefix keeps two bundled copies
// of the library (e.g. vanilla + react entries on one page) from colliding.
const prefix = `iris${Math.random().toString(36).slice(2, 6)}`;
let counter = 0;

/** Merge new options over old. Simple keys replace; `advanced` and
 *  `advanced.motion` merge one level deep so partial updates compose. */
export function mergeOptions(oldO: IrisifyOptions, newO: IrisifyOptions): IrisifyOptions {
  return {
    ...oldO,
    ...newO,
    advanced:
      oldO.advanced || newO.advanced
        ? {
            ...oldO.advanced,
            ...newO.advanced,
            motion:
              oldO.advanced?.motion || newO.advanced?.motion
                ? { ...oldO.advanced?.motion, ...newO.advanced?.motion }
                : undefined,
          }
        : undefined,
  };
}

export type ControllerSetup = {
  /** Receives the outer halo layers - must paint BEHIND the host element. */
  under: HTMLElement;
  /** Receives the border ring + inner glow - must paint ABOVE the host element. */
  over: HTMLElement;
  /** Size source: the box the glow hugs. */
  measureEl: HTMLElement;
  /** Corner-radius source (defaults to measureEl). */
  radiusEl?: () => Element | null;
  /** Called before each re-render so the caller can reposition the containers. */
  syncBox?: () => void;
  options: IrisifyOptions;
};

export type Controller = {
  update(options: IrisifyOptions): void;
  setOptions(options: IrisifyOptions): void;
  refresh(): void;
  getOptions(): IrisifyOptions;
  destroy(): void;
};

function parseRadiusPx(el: Element, w: number, h: number): number {
  const v = getComputedStyle(el).borderTopLeftRadius;
  let r: number;
  if (v.endsWith("%")) r = (parseFloat(v) / 100) * Math.min(w, h);
  else r = parseFloat(v) || 0;
  return Math.max(0, Math.min(r, Math.min(w, h) / 2));
}

export function createController(setup: ControllerSetup): Controller {
  const { under, over, measureEl } = setup;
  const doc = measureEl.ownerDocument;
  const win = doc.defaultView ?? window;
  const cls = `${prefix}-${counter++}`;
  let options = setup.options;
  let stopDriver: () => void = () => {};
  let styleEl: HTMLStyleElement | null = null;
  let destroyed = false;
  let renderQueued = false;
  let queuedFrame = 0;

  // Decorative only: invisible to assistive tech, transparent to the pointer.
  for (const c of [under, over]) {
    c.setAttribute("aria-hidden", "true");
    c.style.pointerEvents = "none";
  }

  // Persist across re-renders (the original kept these in refs across effect
  // restarts): a held flash dismissed mid-entry must exit from its actual head
  // position, and Stop/replay must never snap the colour-flow phase.
  const holdHeadRef = { current: 0 };
  const flowPhaseRef = { current: 0 };

  const media = typeof win.matchMedia === "function"
    ? win.matchMedia("(prefers-reduced-motion: reduce)")
    : null;

  function render() {
    if (destroyed) return;
    setup.syncBox?.();
    const config: ResolvedConfig = resolveConfig(options, {
      reducedMotion: media?.matches ?? false,
    });
    const w = measureEl.offsetWidth;
    const h = measureEl.offsetHeight;
    stopDriver();
    stopDriver = () => {};
    if (config.disabled || w < 2 || h < 2) {
      under.replaceChildren();
      over.replaceChildren();
      styleEl?.remove();
      styleEl = null;
      return;
    }
    const radiusSrc = setup.radiusEl?.() ?? measureEl;
    const radius =
      config.radiusOverride != null
        ? Math.max(0, Math.min(config.radiusOverride, Math.min(w, h) / 2))
        : parseRadiusPx(radiusSrc, w, h);

    const motion = config.motion;
    const moving = motion.mode === "lights";
    // sideFlash: the JS-gradient two-arm flash - the only path that honours
    // origin/destination, stay-lit mode, or overlapping flights (negative gap,
    // which a CSS keyframe can't do). The pure-CSS conic survives ONLY for the
    // canonical bottom→top flash (origin 180 / dest 0, vertical axis): it costs
    // no animation loop and is pixel-identical to the original. The moment any
    // of those defaults change, route through JS automatically - so setting
    // flashOriginAngle / flashDestAngle "just works" without also flipping
    // flashAxis (which stays as an explicit escape hatch, no longer required).
    const customDirection =
      motion.flashOriginAngle !== 180 || motion.flashDestAngle !== 0;
    const sideFlash =
      motion.mode === "flash" &&
      (motion.flashAxis === "horizontal" ||
        motion.flashHold ||
        config.gapBetween < 0 ||
        customDirection);
    const jsGradient = moving || sideFlash;

    // Perimeter map - maps screen angle ↔ border arc-length for THIS element's
    // aspect ratio, so colours can scroll at uniform border speed.
    const perimeterMap = makePerimeterMap(w / 2, h / 2, radius);

    // Resolve placement → lit arcs (shared by BOTH modes). `lights` scrolls
    // colour through them; `flash` is confined to them via a static window mask.
    let placementArcs: { start: number; span: number }[];
    if (motion.useCustomArc) {
      let a0 = motion.startAngle;
      let a1 = motion.startAngle + motion.sweep;
      if (motion.sweep < 0) [a0, a1] = [a1, a0];
      const f0 = fracAtAngle(perimeterMap, a0);
      let span = fracAtAngle(perimeterMap, a1) - f0;
      if (span <= 0) span += 1;
      if (Math.abs(motion.sweep) >= 359.5) span = 1;
      placementArcs = [{ start: f0, span }];
    } else {
      placementArcs = sidesToArcs(perimeterMap, motion.sides);
    }
    const fullPlacement = placementArcs.length === 1 && placementArcs[0].span >= 0.999;

    // Two arcs from flashOriginAngle to flashDestAngle: arm-A goes CW (origin →
    // dest), arm-B goes CCW reversed. Both noEndFade so origin and dest caps stay
    // full-brightness; each carries ONE travelling band (the original flash is a
    // wedge that MOVES - it leaves the origin and dissolves into the destination).
    const sideFlashTrail = Math.min(1, Math.max(0.1, motion.flashTrail ?? SIDE_FLASH_BAND));
    const spanBetween = (start: number, end: number) => {
      let span = end - start;
      if (span <= 0) span += 1;
      return span;
    };
    const originFrac = fracAtAngle(perimeterMap, motion.flashOriginAngle);
    const destFrac = fracAtAngle(perimeterMap, motion.flashDestAngle);
    const sideFlashArcs: LightArc[] = [
      // CW arm: origin → dest
      { start: originFrac, span: spanBetween(originFrac, destFrac), bandU: sideFlashTrail, noEndFade: true, noWrap: true },
      // CCW arm: dest → origin (CW) reversed so colours read origin→dest
      { start: destFrac, span: spanBetween(destFrac, originFrac), bandU: sideFlashTrail, reverse: true, noEndFade: true, noWrap: true },
    ];

    // band width → arc-units (per chosen unit) baked into each arc, for `lights`.
    const arcs: LightArc[] = placementArcs.map(({ start, span }) => {
      const w0 = motion.width;
      const bandU =
        motion.widthUnit === "arc" ? w0 / 100 :
        motion.widthUnit === "border" ? w0 / 100 / (span || 1e-6) :
        /* px */ w0 / (span * perimeterMap.L || 1e-6);
      return { start, span, bandU: Math.max(0.01, Math.min(1, bandU)) };
    });

    // Flash confinement: a static window mask when the placement isn't the full
    // ring. The mirrored half is X-flipped at render time, so it needs the window
    // reflected across the vertical axis (perimeter frac → 1−frac) to land on the
    // SAME screen region - otherwise "right" leaks onto the left.
    const flashWindowMask =
      motion.mode === "flash" && !fullPlacement
        ? buildWindowMaskConic(perimeterMap, placementArcs, motion.feather)
        : undefined;
    const flashWindowMaskMirror =
      motion.mode === "flash" && !fullPlacement
        ? buildWindowMaskConic(
            perimeterMap,
            placementArcs.map((a) => ({
              start: (((1 - (a.start + a.span)) % 1) + 1) % 1,
              span: a.span,
            })),
            motion.feather,
          )
        : undefined;

    const gradArgs: GradArgs | null = jsGradient
      ? {
          map: perimeterMap,
          stops: config.stops,
          // sideFlash: one travelling band per arm, full spectrum across the band
          // (like the original wedge), positioned each frame via the driver.
          arcs: sideFlash ? sideFlashArcs : arcs,
          fill: sideFlash ? "bands" : motion.fill,
          count: sideFlash ? 1 : motion.count,
          feather: motion.feather,
          // authored conic angles → the wedge colour profile matches B→T
          stopAngles: config.stopAngles,
          trailFade: sideFlash ? motion.flashTrailFade : undefined,
        }
      : null;

    // ── styles ──
    ensureBaseStyles(doc);
    if (!styleEl) {
      styleEl = doc.createElement("style");
      styleEl.setAttribute("data-irisify", cls);
      doc.head.appendChild(styleEl);
    }
    styleEl.textContent = buildStyles(
      cls,
      config.stops.length,
      config.duration,
      config.gapBetween,
      config.easing,
      config.stopAngles,
      config.fadeInAt,
      config.visibleUntil,
      motion,
      jsGradient,
    );

    // ── container vars (the original's parent CSS custom properties) ──
    for (const c of [under, over]) {
      c.style.setProperty("--iris-w", `${w}px`);
      c.style.setProperty("--iris-h", `${h}px`);
      c.style.setProperty("--iris-play", config.paused ? "paused" : "running");
      config.stops.forEach((s, i) => c.style.setProperty(`--iris-c${i}`, stopCss(s)));
      c.style.overflow = "visible";
    }
    if (config.zIndex != null) over.style.zIndex = String(config.zIndex);
    else over.style.removeProperty("z-index");

    // ── layers ──
    const tree = buildLayers(
      { doc, cls, w, h, radius, config, sideFlash, jsGradient },
      { moving, flashWindowMask, flashWindowMaskMirror },
    );
    under.replaceChildren(...tree.under);
    over.replaceChildren(...tree.over);

    // ── driver (JS-gradient paths only; the CSS flash animates itself) ──
    if (gradArgs) {
      stopDriver = startDriver({
        nodes: [under, over],
        gradArgs,
        duration: config.duration,
        gapBetween: config.gapBetween,
        paused: config.paused,
        motion,
        flashDismiss: config.flashDismiss,
        sideFlash,
        sideFlashTrail,
        fadeInAt: config.fadeInAt,
        visibleUntil: config.visibleUntil,
        easing: config.easing,
        holdHeadRef,
        flowPhaseRef,
      });
    } else {
      // leaving a JS mode: clear the stale conic so the CSS path isn't tinted
      for (const c of [under, over]) {
        c.style.removeProperty("--iris-grad");
        c.style.removeProperty("--iris-grad-lo");
      }
    }
  }

  // Coalesce resize bursts into one re-render per frame.
  const queueRender = () => {
    if (renderQueued || destroyed) return;
    renderQueued = true;
    queuedFrame = win.requestAnimationFrame(() => {
      queuedFrame = 0;
      renderQueued = false;
      render();
    });
  };

  const ro = typeof win.ResizeObserver === "function" ? new win.ResizeObserver(queueRender) : null;
  ro?.observe(measureEl);
  const onMedia = () => queueRender();
  media?.addEventListener?.("change", onMedia);

  render();

  return {
    update(next: IrisifyOptions) {
      options = mergeOptions(options, next);
      render();
    },
    setOptions(next: IrisifyOptions) {
      options = next;
      render();
    },
    refresh: render,
    getOptions: () => options,
    destroy() {
      destroyed = true;
      if (queuedFrame) win.cancelAnimationFrame(queuedFrame);
      stopDriver();
      ro?.disconnect();
      media?.removeEventListener?.("change", onMedia);
      styleEl?.remove();
      under.replaceChildren();
      over.replaceChildren();
    },
  };
}
