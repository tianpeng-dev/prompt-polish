import { build } from "esbuild";
import { mkdir, copyFile } from "node:fs/promises";

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
await mkdir("dist/fonts", { recursive: true });
await Promise.all([
  ...[400, 600].map((weight) =>
    copyFile(
      `node_modules/@fontsource/geist/files/geist-latin-${weight}-normal.woff2`,
      `dist/fonts/geist-${weight}.woff2`,
    ),
  ),
  copyFile(
    "node_modules/@fontsource/jetbrains-mono/files/jetbrains-mono-latin-400-normal.woff2",
    "dist/fonts/jetbrains-mono-400.woff2",
  ),
  ...["adjustments-horizontal", "chevron-down", "copy", "brain", "check"].map(
    (name) =>
      copyFile(
        `node_modules/@tabler/icons/icons/outline/${name}.svg`,
        `desktop/renderer/icons/${name}.svg`,
      ),
  ),
  copyFile(
    "node_modules/@fontsource/geist/LICENSE",
    "dist/fonts/GEIST-LICENSE",
  ),
  copyFile(
    "node_modules/@fontsource/jetbrains-mono/LICENSE",
    "dist/fonts/JETBRAINS-MONO-LICENSE",
  ),
]);
