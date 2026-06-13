/** Built-in gradient palettes. Use by name (`colors: "sunset"`) or copy one and
 *  tweak it - every entry is plain CSS colour strings. Stops are sampled
 *  cyclically for flowing modes, so the last colour blends back into the first. */
export const IRISIFY_PALETTES = {
  /** The signature irisify rainbow - the default (exact OKLCH stops, incl. the
   *  soft semi-transparent pink/blue tail that gives the flash its glow). */
  iris: [
    "oklch(0.452 0.249 264.1)",
    "oklch(0.797 0.052 228.7)",
    "oklch(0.843 0.195 87)",
    "oklch(0.628 0.258 27.4)",
    "oklch(0.7 0.322 316)",
    "oklch(0.782 0.161 319.8 / 0.8)",
    "oklch(0.778 0.102 249.2 / 0.631)",
  ],
  /** Ice-blue → cyan → aqua → mint → pale-yellow northern-lights wash. */
  aurora: ["#0b59ed", "#98d0ff", "#8bebfe", "#4eeafb", "#a7f392", "#fff07c", "#95c1ffa1"],
  /** Deep blues and teals. */
  ocean: ["#0ea5e9", "#22d3ee", "#2dd4bf", "#6366f1"],
  /** Orange → rose → magenta → amber. */
  sunset: ["#f97316", "#f43f5e", "#d946ef", "#fbbf24"],
  /** Soft pinks and pastels. */
  candy: ["#f472b6", "#c084fc", "#818cf8", "#38bdf8"],
  /** Hot reds and oranges. */
  ember: ["#ef4444", "#f97316", "#fbbf24", "#f43f5e"],
  /** Acid brights. */
  neon: ["#22d3ee", "#a3e635", "#f0abfc", "#facc15"],
  /** Greyscale shimmer - for monochrome UIs. */
  mono: ["#52525b", "#d4d4d8", "#a1a1aa", "#f4f4f5"],
} as const;

export type IrisifyPaletteName = keyof typeof IRISIFY_PALETTES;
