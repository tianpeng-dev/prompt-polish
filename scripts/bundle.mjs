import { build } from "esbuild";

await Promise.all([
  // Sandboxed preload may require only Electron, not local Node modules.
  build({
    entryPoints: ["desktop/preload.ts"],
    bundle: true,
    platform: "node",
    format: "cjs",
    external: ["electron"],
    outfile: "dist/desktop/preload.cjs",
  }),
  build({
    entryPoints: ["desktop/renderer/app.ts"],
    bundle: true,
    platform: "browser",
    format: "iife",
    outfile: "dist/desktop/renderer/app.js",
  }),
]);
