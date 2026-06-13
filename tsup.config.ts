import { defineConfig } from "tsup";

export default defineConfig([
  {
    entry: { index: "src/index.ts" },
    format: ["esm", "cjs"],
    dts: true,
    sourcemap: true,
    clean: true,
    target: "es2020",
  },
  {
    entry: { "react/index": "src/react/index.tsx" },
    format: ["esm", "cjs"],
    dts: true,
    sourcemap: true,
    target: "es2020",
    external: ["react"],
    // Next.js app router: the React bindings use hooks, so consumers need the
    // client boundary baked into the bundle.
    banner: { js: '"use client";' },
  },
]);
