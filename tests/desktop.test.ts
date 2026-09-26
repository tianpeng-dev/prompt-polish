import { describe, expect, it, vi } from "vitest";
import {
  calculateWindowPosition,
  constrainWindowPosition,
  createClipboardController,
  DEFAULT_SETTINGS,
  desktopPlatform,
  formatShortcut,
  loginItemSettings,
  normalizeSettings,
  selectDisplayForBounds,
  shouldHideWindowOnBlur,
  shouldShowWindowAtStartup,
  trayIconName,
  validateSettingsUpdate,
  validateShortcut,
} from "../desktop/logic.js";
import type { OptimizeResponse } from "../src/types.js";

function response(optimized: string): OptimizeResponse {
  return {
    optimized,
    metrics: {
      inputChars: 4,
      outputChars: optimized.length,
      expansionRatio: 2,
      durationMs: 20,
      tokenUsage: null,
    },
    traceId: "trace",
  };
}

describe("desktop settings", () => {
  it("normalizes valid settings and rejects unsafe global shortcuts", () => {
    expect(
      normalizeSettings({
        schemaVersion: 1,
        launchAtLogin: false,
        optimizeClipboardOnShortcut: true,
        shortcut: "Option+Command+K",
      }),
    ).toEqual({
      schemaVersion: 2,
      launchAtLogin: false,
      optimizeClipboardOnShortcut: true,
      shortcut: "CommandOrControl+Alt+K",
      alwaysOnTop: true,
      windowPosition: null,
    });
    expect(() => validateShortcut("Option+P")).toThrow("Command 或 Ctrl");
    expect(() => validateShortcut("Command+P")).toThrow("再加入");
    expect(() => validateShortcut("Command+Alt+PageDown")).toThrow("字母");
  });

  it("migrates existing settings with shortcut clipboard optimization disabled", () => {
    const migrated = normalizeSettings({
      schemaVersion: 1,
      launchAtLogin: false,
      shortcut: "Command+Option+K",
    });
    expect(migrated).toMatchObject({
      schemaVersion: 2,
      launchAtLogin: false,
      optimizeClipboardOnShortcut: false,
      shortcut: "CommandOrControl+Alt+K",
      alwaysOnTop: true,
      windowPosition: null,
    });
  });

  it("keeps valid positions and discards invalid coordinates", () => {
    expect(
      normalizeSettings({
        schemaVersion: 2,
        launchAtLogin: false,
        optimizeClipboardOnShortcut: true,
        shortcut: "Command+Option+K",
        alwaysOnTop: false,
        windowPosition: { x: -810.6, y: 42.4 },
      }),
    ).toEqual({
      schemaVersion: 2,
      launchAtLogin: false,
      optimizeClipboardOnShortcut: true,
      shortcut: "CommandOrControl+Alt+K",
      alwaysOnTop: false,
      windowPosition: { x: -811, y: 42 },
    });
    expect(
      normalizeSettings({
        ...DEFAULT_SETTINGS,
        windowPosition: { x: Number.NaN, y: 20 },
      }).windowPosition,
    ).toBeNull();
  });

  it("falls back when the persisted schema or shortcut is invalid", () => {
    expect(normalizeSettings({ schemaVersion: 3 })).toEqual(DEFAULT_SETTINGS);
    expect(
      normalizeSettings({
        schemaVersion: 1,
        launchAtLogin: false,
        shortcut: "P",
      }).shortcut,
    ).toBe(DEFAULT_SETTINGS.shortcut);
    expect(formatShortcut(DEFAULT_SETTINGS.shortcut, "darwin")).toBe("⌥⌘P");
    expect(formatShortcut(DEFAULT_SETTINGS.shortcut, "win32")).toBe(
      "Ctrl+Alt+P",
    );
  });

  it("rejects invalid pin settings at the IPC boundary", () => {
    expect(validateSettingsUpdate({ alwaysOnTop: false })).toEqual({
      launchAtLogin: undefined,
      optimizeClipboardOnShortcut: undefined,
      shortcut: undefined,
      alwaysOnTop: false,
    });
    expect(() => validateSettingsUpdate({ alwaysOnTop: "yes" })).toThrow(
      "窗口置顶设置无效",
    );
    expect(
      validateSettingsUpdate({ windowPosition: { x: 1, y: 2 } }),
    ).not.toHaveProperty("windowPosition");
  });

  it("selects platform-specific tray, login, and startup behavior", () => {
    expect(desktopPlatform("darwin")).toBe("darwin");
    expect(desktopPlatform("win32")).toBe("win32");
    expect(desktopPlatform("linux")).toBe("other");
    expect(trayIconName("darwin")).toBe("tray-iconTemplate.png");
    expect(trayIconName("win32")).toBe("tray-icon-win.png");
    expect(loginItemSettings("darwin", true, "/app")).toEqual({
      openAtLogin: true,
      type: "mainAppService",
    });
    expect(loginItemSettings("win32", true, "C:\\App\\精炼台.exe")).toEqual({
      openAtLogin: true,
      path: "C:\\App\\精炼台.exe",
      args: ["--hidden"],
      enabled: true,
      name: "精炼台",
    });
    expect(
      shouldShowWindowAtStartup("win32", ["app.exe", "--hidden"], false),
    ).toBe(false);
    expect(shouldShowWindowAtStartup("win32", ["app.exe"], false)).toBe(true);
    expect(shouldShowWindowAtStartup("darwin", [], true)).toBe(false);
  });
});

describe("popover placement", () => {
  it("centers beneath the tray and clamps to the active work area", () => {
    expect(
      calculateWindowPosition(
        { x: 900, y: 0, width: 24, height: 24 },
        { x: 0, y: 24, width: 1200, height: 800 },
        { width: 480, height: 680 },
      ),
    ).toEqual({ x: 672, y: 32 });
    expect(
      calculateWindowPosition(
        { x: 2, y: 0, width: 18, height: 24 },
        { x: 0, y: 24, width: 800, height: 700 },
        { width: 480, height: 680 },
      ).x,
    ).toBe(8);
  });

  it("anchors beside vertical Windows taskbars", () => {
    expect(
      calculateWindowPosition(
        { x: 1920, y: 600, width: 48, height: 48 },
        { x: 0, y: 0, width: 1920, height: 1080 },
        { width: 440, height: 240 },
      ),
    ).toEqual({ x: 1472, y: 504 });
    expect(
      calculateWindowPosition(
        { x: 0, y: 300, width: 48, height: 48 },
        { x: 48, y: 0, width: 1872, height: 1080 },
        { width: 440, height: 240 },
      ),
    ).toEqual({ x: 56, y: 204 });
  });

  it("snaps near all work-area edges and clamps off-screen windows", () => {
    const workArea = { x: 0, y: 24, width: 1200, height: 800 };
    expect(
      constrainWindowPosition(
        { x: 5, y: 30, width: 440, height: 240 },
        workArea,
      ),
    ).toEqual({ x: 8, y: 32 });
    expect(
      constrainWindowPosition(
        { x: 750, y: 570, width: 440, height: 240 },
        workArea,
      ),
    ).toEqual({ x: 752, y: 576 });
    expect(
      constrainWindowPosition(
        { x: -300, y: 900, width: 440, height: 240 },
        workArea,
      ),
    ).toEqual({ x: 8, y: 576 });
    expect(
      constrainWindowPosition(
        { x: -1915, y: 5, width: 440, height: 240 },
        { x: -1920, y: 0, width: 1920, height: 1080 },
      ),
    ).toEqual({ x: -1912, y: 8 });
  });

  it("chooses the display with the largest overlap and falls back to primary", () => {
    const displays = [
      { id: 1, workArea: { x: -1920, y: 0, width: 1920, height: 1080 } },
      { id: 2, workArea: { x: 0, y: 24, width: 1440, height: 876 } },
    ];
    expect(
      selectDisplayForBounds(
        { x: -300, y: 100, width: 440, height: 240 },
        displays,
        2,
      )?.id,
    ).toBe(1);
    expect(
      selectDisplayForBounds(
        { x: 5000, y: 5000, width: 440, height: 240 },
        displays,
        2,
      )?.id,
    ).toBe(2);
  });

  it("keeps pinned windows visible on blur", () => {
    expect(shouldHideWindowOnBlur(true, false)).toBe(false);
    expect(shouldHideWindowOnBlur(false, false)).toBe(true);
    expect(shouldHideWindowOnBlur(false, true)).toBe(false);
  });
});

describe("clipboard optimization", () => {
  it("overwrites only after successful optimization and restores once", async () => {
    let clipboardText = "修复登录";
    const writeText = vi.fn((value: string) => {
      clipboardText = value;
    });
    const controller = createClipboardController({
      clipboard: {
        readText: () => clipboardText,
        writeText,
      },
      optimize: vi.fn(async () => response("请定位并修复登录问题。")),
    });

    const result = await controller.optimize();
    expect(result.source).toBe("修复登录");
    expect(clipboardText).toBe("请定位并修复登录问题。");
    expect(controller.canUndo()).toBe(true);
    expect(controller.undo()).toEqual({
      restored: true,
      text: "修复登录",
      operationId: result.operationId,
    });
    expect(clipboardText).toBe("修复登录");
    expect(controller.undo()).toEqual({ restored: false });
  });

  it("preserves the clipboard on empty, overlong, or failed requests", async () => {
    for (const original of [" ", "x".repeat(2001), "正常输入"]) {
      let clipboardText = original;
      const writeText = vi.fn((value: string) => {
        clipboardText = value;
      });
      const controller = createClipboardController({
        clipboard: { readText: () => clipboardText, writeText },
        optimize: vi.fn(async () => {
          throw new Error("upstream failed");
        }),
      });
      await expect(controller.optimize()).rejects.toThrow();
      expect(writeText).not.toHaveBeenCalled();
      expect(clipboardText).toBe(original);
      expect(controller.canUndo()).toBe(false);
    }
  });
});
