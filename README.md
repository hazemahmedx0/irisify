# irisify

Iridescent border glow for any element - a perimeter-mapped rainbow flash/lights engine with **zero dependencies**.

- 🌈 The full effect: flashing rainbow wedge, travelling beams, flowing rainbow, pulse, draw-on reveal, stay-lit hold - with an inner glow, a soft outer halo and a crisp 1px ring, all composable.
- 📦 **Zero runtime dependencies.** No Tailwind, no CSS framework, no asset files. Everything is generated CSS (conic gradients + SVG data-URI masks). Works next to shadcn/ui, plain HTML, anything.
- 🧩 **Works on any element** - a card, a button, a section, an input, a circle avatar. Corner radius is auto-detected.
- ⚛️ Framework-free core (`irisify`) + optional React bindings (`irisify/react`).
- ♿ **Decoration only**: overlays are `aria-hidden`, `pointer-events: none`, and `prefers-reduced-motion` is respected by default.
- ⚡ Engineered for 60fps: colour is mapped to border **arc-length** (not angle, so nothing whips around corners), crisp layers get a high-res gradient while blurred halos get a cheap low-res one, and a static glow costs zero per-frame work.

```bash
npm i irisify
# or
pnpm add irisify
```

## Quick start (React)

```tsx
import { Irisify } from "irisify/react";

<Irisify>
  <div className="card">Ask anything…</div>
</Irisify>
```

That's the original flash - a rainbow wedge that blooms from the bottom and converges at the top. Pick another preset and a couple of knobs:

```tsx
<Irisify preset="beam" speed={5} colors={["#22d3ee", "#818cf8", "#e879f9"]}>
  <button className="btn">Generate ✨</button>
</Irisify>
```

Or attach to your own element with no wrapper:

```tsx
import { useIrisify } from "irisify/react";

const ref = useIrisify<HTMLDivElement>({ preset: "rainbow" });
return <div ref={ref} className="card">…</div>;
```

## Quick start (vanilla / any framework)

```ts
import { irisify } from "irisify";

const instance = irisify(document.querySelector(".card"), { preset: "hold" });

instance.dismiss();          // hold preset: sweep the glow away
instance.update({ speed: 2 });
instance.destroy();
```

The element gets two sibling overlays sandwiching it (halo **behind**, ring + inner glow **on top**) so an opaque background keeps your content perfectly readable - the same layer order as the original design.

## Level 1 - the simple API

| Option | Type / default | What it does |
| --- | --- | --- |
| `preset` | `"flash"` (default) · `"hold"` · `"beam"` · `"rainbow"` · `"pulse"` · `"glow"` · `"reveal"` | What the light does (see below) |
| `colors` | palette name or `string[]` - default `"iris"` | The gradient - see [Colors](#colors) |
| `speed` | `number` (seconds) | One cycle: one flash, one lap, one breath |
| `glow` | `"inside" \| "outside" \| "both"` (default `"both"`) | Where the bloom lives relative to the border |
| `intensity` | `number` 0–2 (default 1) | Overall glow strength |
| `border` | `boolean` (default `true`) | The crisp 1px rainbow ring |
| `placement` | `"all"` · `Side[]` · `{ start, sweep }` (degrees) | Which part of the border is lit |
| `direction` | `"clockwise" \| "counterclockwise"` | Travel direction |
| `gap` | `number` (seconds) | Rest between cycles. **Negative** (flash/hold): the next flash launches while the previous one is still fading |
| `paused` | `boolean` | Freeze on the current frame |
| `dismissed` | `boolean` | `hold` preset: sweep the held glow away / play it back in |
| `radius` | `number` (px) | Corner radius override (auto-detected from CSS otherwise) |
| `reducedMotion` | `"static"` (default) · `"none"` · `"ignore"` | What `prefers-reduced-motion` users see |
| `enabled` | `boolean` (default `true`) | Master switch - `false` removes the effect entirely (no DOM, no work). Great for "glow while loading" |

### Presets

- **`flash`** - the original. A rainbow wedge fades in, sweeps bottom → top along both sides, and dissolves as the arms converge.
- **`hold`** - the flash travels in, then **stays lit** with the colours flowing. Flip `dismissed` to sweep it away.
- **`beam`** - one comet band travelling around the border (border-beam style).
- **`rainbow`** - the whole border lit, colours flowing around it.
- **`pulse`** - the lit border breathing in and out.
- **`glow`** - a static lit border. No animation loop at all - zero per-frame cost.
- **`reveal`** - the border draws itself on as one continuous piece, flashes off, repeats.

The simple options *compose with* the preset: `placement` confines any preset to sides or an exact arc, `colors`/`speed`/`intensity` re-skin it, and so on. Each preset is plain data - import `IRISIFY_PRESETS` to see exactly what one sets and build on it.

## Colors

Three levels of control, lowest effort first:

**1. Pick a built-in palette by name:**

```tsx
<Irisify preset="rainbow" colors="sunset"> … </Irisify>
```

`iris` (the signature rainbow - default) · `aurora` · `ocean` · `sunset` · `candy` · `ember` · `neon` · `mono`. They're exported as plain CSS strings (`IRISIFY_PALETTES`), so copy one and tweak it.

**2. Pass your own CSS colours** - hex, rgb, hsl or oklch, in the order they appear along the gradient:

```tsx
<Irisify colors={["#22d3ee", "#818cf8", "#e879f9"]}> … </Irisify>
```

Flowing modes sample the list **cyclically** - the last colour blends back into the first, so a loop never shows a seam. Alpha is honoured (`"rgb(255 0 234 / 60%)"` gives a softer stop, like the original's translucent pink tail).

**3. Exact engine control** - `advanced.stops` takes OKLCH stops directly (`{ l, c, h, a }[]`, what the engine natively blends in), and `advanced.stopAngles` sets where each colour sits inside the **flash wedge** (the original's authored 16°/30°/43°/59°/72°/84° spacing). Use these when you need the flash to reproduce a brand gradient exactly.

```tsx
<Irisify advanced={{
  stops: [
    { l: 0.452, c: 0.249, h: 264.1, a: 1 },   // blue
    { l: 0.843, c: 0.195, h: 87.0,  a: 1 },   // yellow
    { l: 0.7,   c: 0.322, h: 316.0, a: 0.8 }, // magenta, 80% alpha
  ],
}}> … </Irisify>
```

## Level 2 - the full engine (`advanced`)

Everything the engine can do is reachable under `advanced`. It wins over the simple options.

```tsx
<Irisify
  advanced={{
    motion: {
      mode: "flash",
      flashOriginAngle: 270,        // start at the left edge centre (auto-switches engine)
      flashDestAngle: 90,           // converge on the right edge centre
      flashTrail: 0.7,              // longer comet trail
      flashTrailFade: 0.5,          // dim the trail behind the head
      flashOverlap: 0.3,            // arms land brighter/earlier on the destination
    },
    easing: "cubic-bezier(0.26, 0.94, 0.6, 1)",
    fadeInAt: 10,                   // keyframe % at full opacity
    visibleUntil: 30,               // keyframe % when the fade starts
    outerGlowBlur: 8,
  }}
>
  <Card />
</Irisify>
```

### `advanced` reference

| Key | Purpose |
| --- | --- |
| `motion` | The full `MotionSpec` (below) |
| `stops` | Rainbow stops in OKLCH (`{ l, c, h, a }[]`) - exact-colour control |
| `stopAngles` | The flash wedge's authored conic stop angles |
| `duration`, `easing`, `fadeInAt`, `visibleUntil`, `gapBetween` | Flash timing - identical semantics to the original keyframes |
| `innerLayers` | The inner glow stack: each pass = a mask shape + blur + opacity + optional size |
| `outerGlowMask`, `outerGlowBlur`, `outerGlowOpacity` | The outer halo |
| `borderEnabled` | The 1px ring |
| `proceduralSpecs` | Override the 6 built-in mask shapes (pill geometry, stroke align, crop, blur…) |
| `symmetric` | Mirror the CSS flash into two beams (the original look) |
| `glowReach` | `"inner" \| "outer" \| "both"` |
| `flashDismiss` | `hold`: dismiss/replay |

### `MotionSpec` (the heart of it)

Two modes:

- **`flash`** - the original wedge. `flashOriginAngle`/`flashDestAngle` put the launch and convergence anywhere on the border (0° = top-centre, clockwise); `flashTrail`/`flashTrailFade`/`flashOverlap` shape the comet; `flashHold` keeps it lit.
- **`lights`** - a fully orthogonal light engine. Choose **where** (`sides: ["top","right"]` or `useCustomArc` + `startAngle`/`sweep`), **what** (`fill: "chain" | "bands"`, `count`, `width` + `widthUnit: "arc" | "border" | "px"`, `feather`), and **how** (`move: "travel" | "static"`, plus `pulse` and `reveal` toggles that compose, `direction`, `repeat: "loop" | "once"`).

All combinations are reachable - 3 bands pulsing on the top edge, a single comet on a custom 120° arc, a draw-on reveal of the left side, etc.

## Vanilla instance API

```ts
const i = irisify(el, options);
i.update({ speed: 2 });   // merge options in
i.setOptions(options);     // replace all options (controlled integrations)
i.pause(); i.play();
i.dismiss(); i.show();    // hold preset
i.refresh();              // re-measure after a manual move
i.destroy();              // remove everything
```

## Accessibility & performance

- Overlays are `aria-hidden="true"` and `pointer-events: none` - screen readers and clicks pass straight through.
- `prefers-reduced-motion: reduce` swaps motion for a still lit border by default (`reducedMotion: "static"`); use `"none"` to render nothing or `"ignore"` to animate anyway.
- The animated modes rewrite **one CSS custom property** per frame (a conic gradient string); blurred layers consume a low-resolution variant so the per-frame raster stays cheap. `preset="glow"` and paused states run **no** loop at all.
- The outer halo blooms past your element. If a parent has `overflow: hidden`, the halo is clipped to it (the ring and inner glow are unaffected).

## License

MIT © [Hazem Aboelsoud](https://hazem.design)
