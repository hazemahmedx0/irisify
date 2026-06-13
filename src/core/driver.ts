import type { MotionSpec } from "../types";
import { easingToFn, smoothstep } from "./easing";
import { fracAtAngle } from "./geometry";
import {
  buildMovingGradient,
  SIDE_FLASH_LIT_HEAD_FW,
  SIDE_FLASH_SWEEP_FRAC,
  SIDE_FLASH_TAIL_FW,
  type LightArc,
  type MovingGradientParams,
} from "./gradient";

export type GradArgs = Omit<MovingGradientParams, "offset" | "alphaMul" | "reveal" | "resolution">;

export type DriverConfig = {
  /** Elements that receive the per-frame `--iris-grad` / `--iris-grad-lo` vars
   *  (every overlay container - CSS custom properties inherit downwards). */
  nodes: HTMLElement[];
  gradArgs: GradArgs;
  duration: number;
  gapBetween: number;
  paused: boolean;
  motion: MotionSpec;
  flashDismiss: boolean;
  sideFlash: boolean;
  sideFlashTrail: number;
  fadeInAt: number;
  visibleUntil: number;
  easing: string;
  /** Eased entry PROGRESS (0–1) of a held flash - persists across driver
   *  restarts so a dismiss that starts mid-entry exits from the actual position. */
  holdHeadRef: { current: number };
  /** Current flow phase of the held flash's colours - persists across restarts
   *  so Stop/replay never snaps the gradient's phase. */
  flowPhaseRef: { current: number };
};

// rAF driver: rewrite --iris-grad. `travel` scrolls the offset (movement);
// `pulse` breathes the alpha in place (come & go); they compose. Crisp layers
// use the full-res conic; the heavily-blurred halo uses a low-res one (blur
// hides the coarseness) so frames stay cheap enough for 60fps.
// Returns a stop() cleanup.
export function startDriver(cfg: DriverConfig): () => void {
  const {
    nodes,
    gradArgs,
    duration,
    gapBetween,
    paused,
    motion,
    flashDismiss,
    sideFlash,
    sideFlashTrail,
    fadeInAt,
    visibleUntil,
    easing,
    holdHeadRef,
    flowPhaseRef,
  } = cfg;
  if (!nodes.length) return () => {};
  const D = Math.max(0.05, duration);
  const G = Math.max(0, gapBetween);
  const T = D + G;
  // Flash flight period - unlike the lights modes, the flash gap may go
  // NEGATIVE: the next flight launches while the previous tail is still
  // fading (most of a flash's late fade sits under ~10% alpha, so even gap 0
  // reads as dead air). Floor at D/2 so at most two flights are ever in the
  // air at once.
  const TF = Math.max(D * 0.5, D + gapBetween);
  const dir = motion.direction < 0 ? -1 : 1;
  const travels = motion.move === "travel";
  // Same curve the CSS-keyframe flash animates with - the JS flash must match.
  const flashEase = easingToFn(easing);
  // Hold-mode colours continue from wherever they were when this driver
  // (re)started - Stop/replay must not snap the gradient's phase.
  const flowBase = flowPhaseRef.current;

  // ── Side-flash speed profile: the B→T original's, on every direction ────
  // The original B→T flash is a CSS conic ROTATION: its head moves at eased
  // ANGULAR speed - on a wide card it launches gently across the long bottom
  // edge (few px per degree near its centre), whips through the side cap and
  // glides into the top - and it stops 30° short (150° of the 180° gap),
  // letting the fade + the wedge's luminous lead close the rest. Trace the
  // original's head through THIS card's angle→perimeter map, reduce that to
  // its MACRO pacing (see refCurve), and drive every arm - whatever its
  // origin and destination - along that same normalised progress curve.
  // Antipodal arms are all half the perimeter, so launch speed, average
  // speed, glide and convergence match the original everywhere.
  //
  // Overlap closes the convergence harder in TWO ways. Position: it
  // stretches the reference sweep past the original's stop-short point
  // (0 = the original convergence - the wedge's lead just reaches the
  // destination; 0.5 = the head lands exactly ON it). Time: it ADVANCES the
  // arrival (`arriveAt`) - at 0 the head lands at the very last instant,
  // when the interval fade has already taken alpha to ~0, so only the faint
  // luminous tips ever touch (exactly the original's behaviour); at higher
  // values the bright bodies close on the destination while the flash is
  // still fully lit, then HOLD there through the fade. Without the time
  // part, max overlap still read as "the arms never meet" - the closure
  // happened in the dark.
  const ovAmt = Math.max(0, motion.flashOverlap ?? 0);
  const sweepFrac = SIDE_FLASH_SWEEP_FRAC + ovAmt * (1 - SIDE_FLASH_SWEEP_FRAC) * 2;
  const arriveAt = 1 - ovAmt * 0.75;
  // Raw head position (arm-u units) at rotation progress p, sweeping `frac`
  // of the reference gap. 180 − p·frac·180 is the original's --deg-start
  // rotation; frac ≤ 1 keeps it in [0°, 180°], so the perimeter fraction
  // stays on the reference arm (no wrap handling).
  const refU = (p: number, frac: number) => {
    const f = fracAtAngle(gradArgs.map, 180 - p * frac * 180);
    return (0.5 - f) / 0.5;
  };
  // The raw curve carries B→T's GEOMETRY SIGNATURE: the head whips through
  // TWO corners with a slower cap between them mid-rotation, then starts its
  // crawl at the top corner. Those positional features read naturally where
  // B→T puts them (the short side caps) - but applied verbatim to another
  // origin/dest pick they land in the MIDDLE of long edges, reading as two
  // stutters mid-journey. So reduce the curve to its MACRO pacing with a
  // single cubic Hermite through the endpoints, keeping the measured launch
  // and arrival-glide slopes: its velocity is quadratic, i.e. mathematically
  // ONE smooth hump - gentle launch out of the origin, one whoosh, long
  // glide into the destination, nothing in between.
  const refCurve = (frac: number) => {
    const end = refU(1, frac);
    const m0 = Math.max(0, Math.min(2 * end, (refU(0.04, frac) - refU(0, frac)) / 0.04));
    const m1 = Math.max(0, Math.min(2 * end, (end - refU(0.96, frac)) / 0.04));
    return (p: number) => {
      p = Math.max(0, Math.min(1, p));
      const p2 = p * p,
        p3 = p2 * p;
      return m0 * (p3 - 2 * p2 + p) + end * (3 * p2 - 2 * p3) + m1 * (p3 - p2);
    };
  };
  const headCurve = refCurve(sweepFrac);
  const holdCurve = motion.flashHold ? refCurve(1) : headCurve;

  // The spectrum repeats once per arc (and per band within an arc), so the stop
  // count must scale with that - at a fixed 30/96, two sides or several bands left
  // <2 stops per colour segment and the travelling colours visibly snapped from
  // stop to stop. ~40 hi / ~20 lo stops per spectrum cycle.
  const cycles =
    gradArgs.arcs.length * (gradArgs.fill === "bands" ? Math.max(1, gradArgs.count) : 1);
  const revealDriven = motion.reveal || sideFlash;
  const hiBase = revealDriven ? 168 : 96;
  const loBase = revealDriven ? 72 : 36;
  const hiPerCycle = revealDriven ? 72 : 40;
  const loPerCycle = revealDriven ? 34 : 20;
  const hiRes = Math.min(revealDriven ? 240 : 192, Math.max(hiBase, cycles * hiPerCycle));
  const loRes = Math.min(revealDriven ? 120 : 96, Math.max(loBase, cycles * loPerCycle));
  const setVar = (name: string, value: string) => {
    for (const n of nodes) n.style.setProperty(name, value);
  };
  const frame = (offset: number, alphaMul: number, reveal = 1, arcsOverride?: LightArc[]) => {
    // crisp layers get the full-res conic; heavily-blurred halo gets a cheap
    // low-res one (blur hides the difference) → light enough to run at 60fps.
    const args = arcsOverride ? { ...gradArgs, arcs: arcsOverride } : gradArgs;
    const hi = buildMovingGradient({ ...args, offset, alphaMul, reveal, resolution: hiRes });
    setVar("--iris-grad", hi);
    // Hold/dismiss (lit arcs): the glow is near-static, so the lo-res shortcut
    // is visible - its stops land at different perimeter positions and the
    // outer bloom's colours drift from the inner ring's. Use the hi conic for
    // both; the cycling/travelling modes keep the cheap halo.
    const nearStatic = arcsOverride?.some((a) => a.lit);
    setVar(
      "--iris-grad-lo",
      nearStatic ? hi : buildMovingGradient({ ...args, offset, alphaMul, reveal, resolution: loRes }),
    );
  };
  if (paused) {
    // FREEZE: keep whatever frame is currently painted (pausing must not blank
    // the glow or jump it). Only paint an initial frame on a first mount.
    if (!nodes[0].style.getPropertyValue("--iris-grad"))
      frame(0, revealDriven ? 0 : 1, revealDriven ? 0 : 1);
    return () => {};
  }
  frame(0, revealDriven ? 0 : 1, revealDriven ? 0 : 1); // initial frame
  // A purely static, non-pulsing, non-revealing light needs no loop.
  if (!sideFlash && !travels && !motion.pulse && !motion.reveal) return () => {};

  let raf = 0;
  let t0 = 0;
  const onceFade = Math.min(0.6, D * 0.3);
  const tick = (ts: number) => {
    if (!t0) t0 = ts;
    const e = (ts - t0) / 1000;
    let offset = 0;
    let alphaMul = 1;
    let reveal = 1;
    let done = false;

    if (sideFlash && motion.flashHold) {
      // Stay-lit mode: the head travels origin → destination once (same ease +
      // fade-in as the cycling flash), then the WHOLE path stays glowing with
      // the colours flowing through it. Dismiss: the tail lifts off the origin,
      // sweeps to the destination and the glow melts away there.
      const tailHide = SIDE_FLASH_TAIL_FW(motion.feather) * sideFlashTrail; // tuck the tail's soft zone behind the origin
      // overshoot covers the head's soft zone so the destination still reaches
      // full brightness once the entry completes
      const ovEff = Math.max(0, motion.flashOverlap ?? 0) + SIDE_FLASH_LIT_HEAD_FW * sideFlashTrail;
      const flow = (flowBase + e / (D * 2.5)) % 1; // the gradient itself keeps playing
      flowPhaseRef.current = flow;
      const p01 = Math.min(1, e / D);

      // Both lit-window edges ride the original's eased sweep curve (full
      // origin→dest gap - the window must close ON the destination,
      // overshooting by ovEff so its soft head clears it), so the stay-lit
      // entry and dismiss match the original's pace on every direction.
      const litArcsAt = (fromP: number, toP: number, fromPad: number) =>
        gradArgs.arcs.map((a) => ({
          ...a,
          lit: {
            from: holdCurve(fromP) + ovEff * fromP + fromPad,
            to: holdCurve(toP) + ovEff * toP,
          },
        }));

      if (!flashDismiss) {
        const eased = flashEase(p01);
        const tIn = Math.max(0.005, fadeInAt / 100);
        alphaMul = p01 < tIn ? flashEase(p01 / tIn) : 1;
        holdHeadRef.current = eased;
        frame(flow, alphaMul, 1, litArcsAt(0, eased, -tailHide));
        raf = requestAnimationFrame(tick);
        return;
      }

      const pHold = holdHeadRef.current || 1;
      const eased = flashEase(p01);
      alphaMul = 1 - smoothstep(0.8, 1, p01); // gentle final melt at the destination
      frame(flow, alphaMul, 1, litArcsAt(eased * pHold, pHold, -tailHide * (1 - eased)));
      if (p01 >= 1) {
        frame(0, 0, 1); // dismissed - stay dark
        return;
      }
      raf = requestAnimationFrame(tick);
      return;
    }

    if (sideFlash) {
      // Mirror the original CSS-keyframe flash exactly: each arm's band TRAVELS
      // from the origin to the destination across the FULL duration with the same
      // timing curve (fast launch out of the origin, slow glide into the
      // destination), while opacity ramps in by fadeInAt%, holds to visibleUntil%,
      // then dissolves to 0 at 100% - the band leaves the origin behind (it goes
      // dark because the light moved on, not because of a global fade) and melts
      // away as it converges on the destination.
      // Flights launch every TF seconds; with a NEGATIVE gap TF < D, so the
      // next flight is in the air while the previous tail still fades - both
      // render at once via per-arc alpha + src-over compositing (fresher
      // flight on top). Each arm's HEAD rides the original conic sweep's
      // progress curve - gentle launch, smooth whoosh, slow glide,
      // undershooting per sweepFrac with the fade + the wedge's lead closing
      // the rest. At launch it is hidden behind the origin and SLIDES OUT
      // (area grows from zero - no snap), like the original wedge emerging
      // from its seam.
      const k = Math.floor(e / TF);
      const arcsNow: LightArc[] = [];
      const tIn = Math.max(0.005, fadeInAt / 100);
      const tHold = Math.min(0.97, Math.max(tIn + 0.01, visibleUntil / 100));
      for (const j of [k, k - 1]) {
        // newest first → composited on top
        if (j < 0) continue;
        const age = e - j * TF;
        if (age >= D) continue; // this flight has fully faded
        const u01 = age / D;
        const eased = Math.max(0, Math.min(1, flashEase(u01)));
        const headU = headCurve(Math.min(1, eased / arriveAt));
        const a =
          u01 < tIn ? flashEase(u01 / tIn) : u01 <= tHold ? 1 : 1 - flashEase((u01 - tHold) / (1 - tHold));
        for (const arc of gradArgs.arcs) arcsNow.push({ ...arc, headU, alpha: a });
      }
      alphaMul = arcsNow.length ? 1 : 0; // per-flight fades are baked per arc

      frame(0, alphaMul, 1, arcsNow.length ? arcsNow : gradArgs.arcs);
      raf = requestAnimationFrame(tick);
      return;
    }

    // draw-on reveal: sweep the lit arc on over D, flash off, rest, repeat.
    if (motion.reveal) {
      const cyc = e % T;
      const drawEnd = D * 0.64;
      if (cyc < D) {
        // Keep the draw front at a uniform perimeter speed. Easing the position
        // made short arcs, especially the top edge, look like they were dragging
        // near the close.
        reveal = Math.min(1, cyc / drawEnd);
        alphaMul = smoothstep(0, D * 0.12, cyc); // quick fade-in of the front
        if (cyc >= drawEnd) {
          alphaMul *= 1 - smoothstep(drawEnd, D, cyc);
        } else if (G <= 0) {
          // no rest configured → blink off smoothly at the wrap instead of popping
          alphaMul *= 1 - smoothstep(D * 0.88, D, cyc);
        }
      } else {
        reveal = 1;
        // Fade a completed arc, not a nearly-completed arc with a visible front,
        // then keep the rest interval fully dark until the next cycle.
        alphaMul = 0;
      }
    }

    // movement
    if (travels) {
      if (motion.repeat === "once") {
        offset = Math.min(e / D, 1) * dir;
      } else {
        offset = ((e / D) * dir) % 1; // seamless continuous travel
      }
    }
    // come & go (independent of movement) + once tail fade. Skipped while
    // revealing - the reveal manages its own alpha.
    if (!motion.reveal) {
      if (motion.pulse) {
        const cyc = e % T;
        const ramp = D * 0.35;
        alphaMul = cyc < D ? smoothstep(0, ramp, cyc) * smoothstep(0, ramp, D - cyc) : 0;
      } else if (travels && motion.repeat === "once") {
        if (e > D) {
          alphaMul = 1 - smoothstep(0, onceFade, e - D); // eased, not linear
          if (alphaMul <= 0.001) {
            alphaMul = 0;
            done = true;
          }
        }
      } else if (travels && G > 0) {
        const cyc = e % T;
        const fade = D * 0.18;
        alphaMul = cyc < D ? smoothstep(0, fade, cyc) * smoothstep(0, fade, D - cyc) : 0;
      }
    }

    frame(offset, alphaMul, reveal);
    if (!done) raf = requestAnimationFrame(tick);
  };
  raf = requestAnimationFrame(tick);
  return () => cancelAnimationFrame(raf);
}
