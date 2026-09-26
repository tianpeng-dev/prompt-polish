import { access, readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { PROJECT_ROOT } from "../src/paths.js";

describe("Windows desktop support", () => {
  it("builds an x64 NSIS installer with Windows icons", async () => {
    const packageJson = JSON.parse(
      await readFile(path.join(PROJECT_ROOT, "package.json"), "utf8"),
    );
    expect(packageJson.scripts["pack:win"]).toContain("--win nsis --x64");
    expect(packageJson.build.win.target).toEqual([
      { target: "nsis", arch: ["x64"] },
    ]);
    expect(packageJson.build.win.icon).toBe("assets/app-icon.png");
    expect(packageJson.build.win.artifactName).toContain("win-${arch}");
    expect(packageJson.build.extraResources).toContainEqual({
      from: "assets/tray-icon-win.png",
      to: "tray-icon-win.png",
    });
    await access(path.join(PROJECT_ROOT, "assets", "app-icon.png"));
    await access(path.join(PROJECT_ROOT, "assets", "tray-icon-win.png"));
  });

  it("keeps Windows shortcuts and startup behavior platform-aware", async () => {
    const [main, renderer, auth] = await Promise.all([
      readFile(path.join(PROJECT_ROOT, "desktop", "main.ts"), "utf8"),
      readFile(
        path.join(PROJECT_ROOT, "desktop", "renderer", "app.ts"),
        "utf8",
      ),
      readFile(path.join(PROJECT_ROOT, "desktop", "trae-web-auth.ts"), "utf8"),
    ]);
    expect(main).toContain('app.setAppUserModelId("com.local.prompt-refiner")');
    expect(main).toContain("loginItemSettings(PLATFORM");
    expect(main).toContain("trayIconName(PLATFORM)");
    expect(renderer).toContain('platform: "darwin"');
    expect(renderer).toContain('"CommandOrControl"');
    expect(renderer).toContain("event.ctrlKey");
    expect(renderer).toContain('showToast("请从精炼台桌面应用打开。"');
    expect(auth).not.toContain("macOS 无法安全保存");
  });

  it("runs tests and packaging on a Windows GitHub runner", async () => {
    const workflow = await readFile(
      path.join(PROJECT_ROOT, ".github", "workflows", "windows-build.yml"),
      "utf8",
    );
    expect(workflow).toContain("runs-on: windows-latest");
    expect(workflow).toContain("run: pnpm test");
    expect(workflow).toContain("run: pnpm pack:win");
    expect(workflow).toContain("actions/upload-artifact@v7");
  });
});
