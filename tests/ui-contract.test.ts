import { readFile } from "node:fs/promises";
import { build } from "esbuild";
import { describe, expect, it } from "vitest";

describe("desktop packaging and UI contracts", () => {
  it("keeps one editor, pin and optimize control and the compact size", async () => {
    const html = await readFile("desktop/renderer/index.html", "utf8");
    const main = await readFile("desktop/main.ts", "utf8");
    expect(html.match(/<textarea\b/g)).toHaveLength(1);
    expect(html).toContain('id="action-button"');
    expect(html).toContain('aria-pressed="true"');
    expect(html).toContain('aria-modal="true"');
    expect(main).toContain("width: 460, height: 176");
  });
  it("preserves native drag isolation, layout, focus and reduced-motion rules", async () => {
    const css = await readFile("desktop/renderer/styles.css", "utf8");
    expect(css).toContain("app-region: drag");
    expect(css).toContain("app-region: no-drag");
    expect(css).toContain(".editor-area");
    expect(css).toContain("min-height: 0");
    expect(css).toContain(".utility-rail");
    expect(css).toContain("input:focus-visible + .switch");
    expect(css).toContain(".detail-panel");
    expect(css).toContain("@media (prefers-reduced-motion: reduce)");
  });
  it("bundles the sandbox preload without local requires and the renderer without Node dependencies", async () => {
    const preload = await build({
      entryPoints: ["desktop/preload.ts"],
      bundle: true,
      platform: "node",
      format: "cjs",
      external: ["electron"],
      write: false,
    });
    const code = preload.outputFiles[0]!.text;
    expect(code.match(/require\([^)]+\)/g)).toEqual(['require("electron")']);
    expect(code).not.toContain("clipboard:write");
    const renderer = await build({
      entryPoints: ["desktop/renderer/app.ts"],
      bundle: true,
      platform: "browser",
      write: false,
    });
    expect(renderer.outputFiles[0]!.text).not.toContain("require(");
  });
  it("never implicitly publishes while packaging and verifies macOS signatures", async () => {
    const pkg = JSON.parse(await readFile("package.json", "utf8"));
    expect(pkg.scripts["pack:win"]).toContain("--publish never");
    expect(pkg.scripts["pack:mac"]).toContain("node scripts/pack-mac.mjs");
    const macScript = await readFile("scripts/pack-mac.mjs", "utf8");
    expect(macScript).toMatch(/"--publish",\s*"never"/);
    expect(pkg.build.mac.identity).toBe("-");
    expect(pkg.build.afterPack).toBe("scripts/after-pack.mjs");
    const verifier = await readFile(
      "scripts/verify-mac-distribution.sh",
      "utf8",
    );
    expect(verifier).toContain("codesign --verify --deep --strict");
    expect(verifier).toContain("ditto -x -k");
  });
});
