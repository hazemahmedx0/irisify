import type { LightFill, OklchStop, StopAngles } from "../types";
import { angleAtFrac, type PerimeterMap } from "./geometry";
import { smoothstep } from "./easing";
import {
  makeWedgeProfile,
  oklchA,
  overRgba,
  rgbaCss,
  sampleCyclicRgb,
  sampleRainbow,
  sampleWedgeRgba,
  type RgbaStop,
} from "./color";

// Width of each side-flash arm's travelling band (the wedge's TRAILING span), as
// a fraction of that arm - the perimeter analogue of the original wedge's 72°
// trailing span over the 180° from origin to destination (72/180 = 0.4); the
// soft leading sliver extends a further half band ahead of the head, exactly
// like the original's 36° lead. The head starts at the origin and the lead
// emerges first - the lit area grows from zero, which is what makes the
// original launch read smooth instead of popping in.
export const SIDE_FLASH_BAND = 0.4;

// Fraction of the origin→destination ANGULAR gap the flash head sweeps before
// the fade-out takes over. The original B→T flash rotates 150° of its 180° gap
// (--deg-start: 180° → 30°) - the head stops short and the wedge's luminous
// lead + the opacity fade close the remaining distance as the arms converge.
export const SIDE_FLASH_SWEEP_FRAC = 150 / 180;

// Soft widths of a held flash's edges (band units). Both need GENEROUS floors
// independent of the user feather: these edges sweep the border during entry /
// dismiss, and a narrow alpha ramp of saturated colour on white reads as a hard
// cut - the halo blur then smears it into a knife streak along the long edges.
// The head matches the travelling wedge's luminous LEAD sliver (~half a band),
// which is exactly why the normal flash head reads soft.
export const SIDE_FLASH_TAIL_FW = (feather: number): number => Math.max(0.35, feather);
export const SIDE_FLASH_LIT_HEAD_FW = 0.45;

export type LightArc = {
  start: number; // perimeter fraction of arc start
  span: number; // perimeter length (0–1)
  bandU: number; // band width in arc-units (0–1); fill="bands" only
  reverse?: boolean; // reveal/colour from the clockwise arc end back to start
  noEndFade?: boolean; // skip the arc-end smoothstep - origin/dest caps stay full-brightness
  noWrap?: boolean; // bands don't tile across the arc ends (a travelling band may
  // hang off an end mid-journey; folding would ghost the overhang
  // onto the opposite end of the arm)
  /** Explicit head-edge position in arc-u units for a noWrap flash arm -
   *  overrides the phase-derived head so the arms can ride the original B→T
   *  conic sweep's progress curve instead of uniform perimeter speed. */
  headU?: number;
  /** Per-arc alpha multiplier for a noWrap flash arm. Lets two overlapping
   *  flash FLIGHTS (negative gapBetween: the next launch starts while the
   *  previous tail still fades) carry their own interval fades and composite
   *  src-over instead of sharing the global alphaMul. */
  alpha?: number;
  /** Explicit lit interval in arc-u units (may extend past [0,1] - clipped to the
   *  arc). Soft tail at `from`, soft head at `to`; colour = the cyclic spectrum
   *  scrolled by `offset` (flowing). Used by the flash hold/dismiss phases. */
  lit?: { from: number; to: number };
};

export type MovingGradientParams = {
  map: PerimeterMap;
  stops: OklchStop[];
  arcs: LightArc[];
  fill: LightFill;
  count: number; // bands per arc
  feather: number; // 0–0.5 - soft fade at ends
  offset: number; // 0–1 - scroll / band position (travel)
  alphaMul: number; // global multiplier (pulse / interval fades)
  reveal?: number; // 0–1 - draw-on: only the first `reveal` of the arc is shown
  resolution?: number;
  /** Authored conic stop angles - when set, noWrap/lit arcs colour with the
   *  original flash wedge profile (sRGB, original spacing) instead of the
   *  uniform OKLCH rainbow, so custom directions match the B→T original. */
  stopAngles?: StopAngles;
  /** Extra brightness falloff along a travelling flash band's trail, 0–1
   *  (MotionSpec.flashTrailFade). 0 = the authored wedge profile untouched. */
  trailFade?: number;
};

// Build a conic gradient whose colour is a function of PERIMETER position. Stops
// are placed at equal perimeter spacing (then mapped to their angle), so the
// colour delta per stop is constant - smooth on straight edges AND corners, and
// scrollable at perfectly uniform speed. Colour is confined to the given arcs;
// `chain` fills each arc with the flowing rainbow, `bands` paints N discrete
// bands per arc.
export function buildMovingGradient(p: MovingGradientParams): string {
  // Fewer stops = cheaper conic raster per frame (perimeter placement keeps it
  // smooth even at corners). 96 is plenty for crisp layers; the blurry halo runs
  // far lower (it's blurred, so detail is wasted) - see `--iris-grad-lo`.
  const N = p.resolution ?? 96;
  // Flash wedge colouring (noWrap / lit arcs) - built once per call.
  const wedge = p.arcs.some((a) => a.noWrap || a.lit)
    ? makeWedgeProfile(p.stops, p.stopAngles)
    : null;
  const samples: { A: number; col: string }[] = [];
  for (let k = 0; k < N; k++) {
    const frac = k / N;
    const A = angleAtFrac(p.map, frac);
    let col = "transparent";
    // composited noWrap (flash-wedge) contributions - overlapping flights of a
    // negative-gap flash both paint the same arm region (src-over, fresher on top)
    let acc: RgbaStop | null = null;
    // find the arc this perimeter position falls in
    for (const arc of p.arcs) {
      let d = frac - arc.start;
      if (d < 0) d += 1;
      if (d > arc.span) continue;
      const uRaw = d / (arc.span || 1e-6); // 0..1 clockwise across this arc
      const u = arc.reverse ? 1 - uRaw : uRaw;
      const wrap = arc.span >= 0.999; // full border → seamless wrap
      // draw-on reveal: only the first `reveal` of the arc is lit, soft front edge.
      const reveal = p.reveal ?? 1;
      let revealA = 1;
      if (reveal < 0.999) {
        const frontW = 0.1;
        revealA = 1 - smoothstep(reveal, Math.min(1, reveal + frontW), u);
        // Soft TAIL too - the drawn piece's starting point is otherwise a razor
        // alpha cut at the arc origin, which the halo blur smears into a hard
        // streak. The tail width shrinks as the front comes back around, so the
        // completed ring is seamless (no dark notch left at the origin).
        // noEndFade arcs (the two flash arms) skip it: the arms ABUT at the
        // flash origin, and fading both to zero there carved a dark notch at
        // the very point the flash is supposed to emanate from.
        const tailW = arc.noEndFade ? 0 : 0.055 * (1 - reveal);
        if (tailW > 0.0005) revealA *= smoothstep(0, tailW, u);
      }
      if (revealA <= 0.001) {
        col = "transparent";
        break;
      }
      // Explicit lit interval (flash hold/dismiss): soft-edged window over the
      // arc, colour = the cyclic spectrum scrolled by `offset` so the gradient
      // keeps flowing while the glow holds in place.
      if (arc.lit) {
        const bw = arc.bandU > 0 ? Math.min(arc.bandU, 1) : SIDE_FLASH_BAND;
        const fwTail = SIDE_FLASH_TAIL_FW(p.feather) * bw;
        const fwHead = SIDE_FLASH_LIT_HEAD_FW * bw;
        const litA =
          smoothstep(0, fwTail, u - arc.lit.from) * smoothstep(0, fwHead, arc.lit.to - u);
        if (litA <= 0.001) {
          col = "transparent";
          break;
        }
        const t = (((u - p.offset) % 1) + 1) % 1;
        // same stops + sRGB blend as the flash wedge - the held glow keeps the
        // original rainbow instead of shifting to an OKLCH-blended palette.
        col = wedge
          ? sampleCyclicRgb(wedge.rgb, t, litA * p.alphaMul)
          : oklchA(sampleRainbow(p.stops, t, true), litA * p.alphaMul);
        break;
      }
      // Arc-end envelope. feather=0 must mean SHARP (alpha 1) - smoothstep(0,0,u)
      // degenerates to a slow ramp across the whole arc (≤25% peak brightness).
      // A small floor keeps the ends anti-aliased without reading as a fade.
      const endFw = Math.max(0.045, p.feather);
      const wAlpha =
        (wrap || arc.noEndFade ? 1 : smoothstep(0, endFw, u) * smoothstep(0, endFw, 1 - u)) *
        revealA;
      // Unified band model (size applies to BOTH fills): `count` bands of width
      // `bandU` evenly spaced across the arc. `chain` colours them with the
      // continuous (cyclic) spectrum and blends across; `bands` gives each band the
      // full rainbow with gaps. A full-width single band = a continuous chain.
      const full = arc.bandU >= 0.999;
      const period = 1 / Math.max(1, p.count);
      // Band half-width, capped at the slot so size > spacing means TOUCHING bands
      // (uncapped, count 3 @ 100% width showed only the middle of the spectrum).
      const halfEff = Math.min(Math.min(arc.bandU, 1) / 2, period / 2);
      const tiled = halfEff >= period / 2 - 1e-9; // bands butt → no gaps
      const phase = p.offset * period;
      // Travelling flash band: colour with the ORIGINAL wedge profile (sRGB,
      // authored stop angles, soft leading sliver ahead of the head - the
      // original's luminous soft start) so custom directions match B→T exactly.
      // d is measured from the head in trailing-span (= band-width) units.
      if (arc.noWrap && wedge) {
        const bw = Math.max(1e-6, Math.min(arc.bandU, 1));
        const headU = arc.headU ?? phase + bw / 2;
        const dHead = (headU - u) / bw;
        // Optional comet falloff: dim the trail progressively behind the head.
        // Clamped at 1 so the soft lead AHEAD of the head (dHead < 0) is untouched.
        const tf = p.trailFade ?? 0;
        const fadeMul = tf > 0 ? Math.pow(Math.min(1, Math.max(0, 1 - dHead)), tf * 3) : 1;
        const c = sampleWedgeRgba(wedge, dHead);
        const aEff = (c ? c[3] : 0) * wAlpha * fadeMul * (arc.alpha ?? 1) * p.alphaMul;
        // ACCUMULATE instead of break: with overlapping flash flights (negative
        // gapBetween) this point may also belong to the other flight's arm -
        // composite src-over, earlier arcs (the fresher flight) on top.
        if (c && aEff > 0.001) {
          const contrib: RgbaStop = [c[0], c[1], c[2], aEff];
          acc = acc ? overRgba(acc, contrib) : contrib;
        }
        continue;
      }
      const rel = (((u - phase) % period) + period) % period;
      const dd = Math.min(rel, period - rel); // distance to nearest band centre
      if (full || dd <= halfEff) {
        if (p.fill === "chain") {
          if (full) {
            // continuous rainbow sampled CYCLICALLY (n segments, last blends back
            // into first) at uniform perimeter speed - every stop gets an equal
            // share of the border and the wrap is seamless. (The old cosine
            // palindrome dwelled at its turning points: the first stop swelled to
            // ~2× its share at the wrap and crowded the rest together.)
            const t = (((u - p.offset) % 1) + 1) % 1;
            col = oklchA(sampleRainbow(p.stops, t, true), wAlpha * p.alphaMul);
          } else {
            const cp = rel <= period / 2 ? 0.5 + dd / (2 * halfEff) : 0.5 - dd / (2 * halfEff);
            const soft = Math.cos(Math.min(1, dd / (halfEff || 1e-6)) * (Math.PI / 2));
            col = oklchA(sampleRainbow(p.stops, cp, false), wAlpha * soft * p.alphaMul);
          }
        } else if (tiled) {
          // bands with no gaps: each slot is a full rainbow sampled CYCLICALLY, so
          // adjacent bands (and the loop wrap) blend with no seam. The palindrome
          // left the faint last stop butting the bright first one - a razor edge
          // at every slot boundary.
          col = oklchA(sampleRainbow(p.stops, rel / period, true), wAlpha * p.alphaMul);
        } else {
          const along = rel <= period / 2 ? 0.5 + dd / (2 * halfEff) : 0.5 - dd / (2 * halfEff);
          // Flat bright centre, edges dissolving over a feather-scaled fraction of
          // the band - never fully razor, so moving edges stay anti-aliased.
          // (noWrap flash bands never reach here - they take the wedge path above.)
          const fw = Math.max(0.07, p.feather);
          const soft = smoothstep(0, fw, along) * smoothstep(0, fw, 1 - along);
          col = oklchA(sampleRainbow(p.stops, along, false), wAlpha * soft * p.alphaMul);
        }
      }
      break;
    }
    if (acc) col = rgbaCss(acc, 1);
    samples.push({ A, col });
  }
  const parts = samples.map((s) => `${s.col} ${s.A.toFixed(2)}deg`);
  // 0° and 360° are the SAME point (top-centre, perimeter frac 0 = 1). Pin BOTH to
  // that point's colour so the conic wrap is seamless - pinning 360° to the last
  // sample (~357°, a different colour) left a hair seam that the halo blur smeared
  // into a vertical streak above the top-centre.
  parts.unshift(`${samples[0].col} 0deg`);
  parts.push(`${samples[0].col} 360deg`);
  return `conic-gradient(from 0deg at 50% 50%, ${parts.join(", ")})`;
}

// A static conic ALPHA mask (white inside the arcs with feathered ends, transparent
// outside) used to CONFINE the flash effect to a placement. Composited (intersect)
// with each layer's shape mask so flash can live on any side / custom arc.
export function buildWindowMaskConic(
  map: PerimeterMap,
  arcs: { start: number; span: number }[],
  feather: number,
  N = 180,
): string {
  const samples: { A: number; a: number }[] = [];
  for (let k = 0; k < N; k++) {
    const frac = k / N;
    const A = angleAtFrac(map, frac);
    let a = 0;
    for (const arc of arcs) {
      let d = frac - arc.start;
      if (d < 0) d += 1;
      if (d > arc.span) continue;
      const u = d / (arc.span || 1e-6);
      // feather=0 → sharp window (the raw smoothstep degenerates into a full-arc
      // ramp); keep a small floor so the cut edges stay anti-aliased.
      const fw = Math.max(0.02, feather);
      a = arc.span >= 0.999 ? 1 : smoothstep(0, fw, u) * smoothstep(0, fw, 1 - u);
      break;
    }
    samples.push({ A, a });
  }
  const stop = (s: { A: number; a: number }, ang: number) =>
    `rgba(255,255,255,${s.a.toFixed(3)}) ${ang.toFixed(2)}deg`;
  const parts = samples.map((s) => stop(s, s.A));
  parts.unshift(stop(samples[0], 0));
  parts.push(stop(samples[samples.length - 1], 360));
  return `conic-gradient(from 0deg at 50% 50%, ${parts.join(", ")})`;
}
