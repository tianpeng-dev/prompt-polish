import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { JSDOM } from "jsdom";
import { readFile } from "node:fs/promises";
import { build } from "esbuild";
import type { DesktopBridge } from "../desktop/types.js";
import { DEFAULT_SETTINGS } from "../desktop/logic.js";

let bundle: string;
let html: string;
const instances: JSDOM[] = [];
const tick = () => new Promise<void>((resolve) => setImmediate(resolve));
const response = (text = "优化结果") => ({
  optimized: text,
  metrics: {
    inputChars: 1,
    outputChars: text.length,
    expansionRatio: text.length,
    durationMs: 1,
    tokenUsage: 1,
  },
  traceId: "synthetic",
});
beforeAll(async () => {
  const output = await build({
    entryPoints: ["desktop/renderer/app.ts"],
    bundle: true,
    platform: "browser",
    format: "iife",
    write: false,
  });
  bundle = output.outputFiles[0]!.text;
  html = await readFile("desktop/renderer/index.html", "utf8");
});
afterEach(() => {
  for (const dom of instances.splice(0)) dom.window.close();
});

async function ui(overrides: Partial<DesktopBridge> = {}) {
  const dom = new JSDOM(html, {
    runScripts: "outside-only",
    url: "https://local.test",
  });
  instances.push(dom);
  const w = dom.window;
  const events: Record<string, (...args: any[]) => void> = {};
  const snapshot = {
    platform: "darwin" as const,
    settings: { ...DEFAULT_SETTINGS },
    shortcutRegistered: true,
    shortcutError: null,
  };
  const bridge = {
    optimizer: {
      health: vi.fn(async () => ({ ok: true, authenticated: true })),
      optimize: vi.fn(async () => response()),
    },
    clipboard: {
      optimize: vi.fn(async (source: string) => ({
        source,
        response: response(),
        operationId: 1,
        clipboardUpdated: true,
      })),
      undo: vi.fn(async () => ({ restored: true, operationId: 1 })),
    },
    settings: {
      get: vi.fn(async () => snapshot),
      update: vi.fn(async (update) => ({
        ...snapshot,
        settings: { ...snapshot.settings, ...update },
      })),
    },
    window: { hide: vi.fn(async () => {}) } as any,
    ...overrides,
  };
  for (const name of [
    "onBlankRequested",
    "onFocusEditor",
    "onClipboardRestored",
    "onOpenSettings",
    "onSettingsChanged",
    "onShortcutOptimizeRequested",
    "onAuthStatus",
    "onOperationError",
  ]) {
    bridge.window[name] = (callback: (...args: any[]) => void) => {
      events[name] = callback;
      return () => {};
    };
  }
  Object.assign(w, { refiner: bridge });
  w.eval(bundle);
  await tick();
  const editor = w.document.querySelector<HTMLTextAreaElement>("#editor")!;
  const action = w.document.querySelector<HTMLButtonElement>("#action-button")!;
  const status = w.document.querySelector<HTMLElement>("#status")!;
  const input = (value: string) => {
    editor.value = value;
    editor.dispatchEvent(new w.Event("input", { bubbles: true }));
  };
  const key = (key: string, init: KeyboardEventInit = {}) =>
    editor.dispatchEvent(
      new w.KeyboardEvent("keydown", {
        key,
        bubbles: true,
        cancelable: true,
        ...init,
      }),
    );
  return { w, events, bridge, editor, action, status, input, key };
}

describe("renderer behavior with the real compiled UI", () => {
  it("restores a blanked draft once but returns to optimize mode when typing a new one", async () => {
    const h = await ui();
    h.input("旧草稿");
    h.events.onBlankRequested!();
    expect(h.editor.value).toBe("");
    expect(h.action.title).toBe("恢复上次草稿");
    h.action.click();
    await tick();
    expect(h.editor.value).toBe("旧草稿");
    h.events.onBlankRequested!();
    h.input("新草稿");
    expect(h.action.dataset.mode).toBe("optimize");
    h.key("Enter");
    await tick();
    expect(h.bridge.optimizer.optimize).toHaveBeenCalledWith("新草稿");
    expect(h.editor.value).toBe("优化结果");
    h.action.click();
    await tick();
    expect(h.editor.value).toBe("新草稿");
  });

  it("switches from undo to optimize after editing a result; respects Shift Enter and IME", async () => {
    const h = await ui();
    h.input("原文");
    h.key("Enter", { shiftKey: true });
    h.key("Enter", { isComposing: true });
    expect(h.bridge.optimizer.optimize).not.toHaveBeenCalled();
    h.key("Enter");
    await tick();
    h.input("改过的结果");
    expect(h.action.dataset.mode).toBe("optimize");
    h.action.click();
    await tick();
    expect(h.bridge.optimizer.optimize).toHaveBeenLastCalledWith("改过的结果");
  });

  it("serializes clipboard UI operations and preserves the previous editor draft for undo", async () => {
    let resolve!: (value: any) => void;
    const optimize = vi.fn(
      () =>
        new Promise<any>((r) => {
          resolve = r;
        }),
    );
    const undo = vi.fn(async () => ({ restored: false, conflict: true }));
    const h = await ui({ clipboard: { optimize, undo } });
    h.input("正在写的草稿");
    h.events.onShortcutOptimizeRequested!("剪贴板源");
    expect(h.editor.readOnly).toBe(true);
    expect(h.editor.value).toBe("剪贴板源");
    h.events.onBlankRequested!();
    h.events.onShortcutOptimizeRequested!("其他内容");
    expect(optimize).toHaveBeenCalledTimes(1);
    resolve({
      source: "剪贴板源",
      response: response(),
      clipboardUpdated: true,
      operationId: 7,
    });
    await tick();
    expect(h.editor.readOnly).toBe(false);
    h.action.click();
    await tick();
    expect(undo).toHaveBeenCalledWith(7);
    expect(h.editor.value).toBe("正在写的草稿");
    expect(h.status.textContent).toContain("剪贴板已有新内容");
  });

  it("does not overwrite a changed editor or apply an unrelated tray undo event", async () => {
    let resolve!: (value: any) => void;
    const optimize = vi.fn(
      () =>
        new Promise<any>((r) => {
          resolve = r;
        }),
    );
    const h = await ui({
      optimizer: { health: vi.fn(async () => ({ ok: true }) as any), optimize },
    });
    h.input("最初内容");
    h.action.click();
    h.input("较新的内容");
    resolve(response());
    await tick();
    expect(h.editor.value).toBe("较新的内容");
    h.events.onClipboardRestored!({
      restored: true,
      text: "旧剪贴板",
      operationId: 99,
    });
    expect(h.editor.value).toBe("较新的内容");
  });

  it("retains the optimization result when clipboard replacement was skipped", async () => {
    const h = await ui({
      clipboard: {
        optimize: vi.fn(async (source) => ({
          source,
          response: response(),
          operationId: 1,
          clipboardUpdated: false,
        })),
        undo: vi.fn(async () => ({ restored: false })),
      },
    });
    h.events.onShortcutOptimizeRequested!("源");
    await tick();
    expect(h.editor.value).toBe("优化结果");
    expect(h.status.textContent).toContain("未覆盖");
  });

  it("traps settings keyboard focus and displays full error detail on demand", async () => {
    const h = await ui();
    h.events.onOpenSettings!();
    const panel = h.w.document.querySelector<HTMLElement>("#settings-panel")!;
    const prompt = h.w.document.querySelector<HTMLElement>(".prompt-box")!;
    expect(prompt.inert).toBe(true);
    expect(panel.getAttribute("aria-modal")).toBe("true");
    const close =
      h.w.document.querySelector<HTMLButtonElement>("#settings-close")!;
    const last =
      h.w.document.querySelector<HTMLButtonElement>("#shortcut-recorder")!;
    last.focus();
    last.dispatchEvent(
      new h.w.KeyboardEvent("keydown", {
        key: "Tab",
        bubbles: true,
        cancelable: true,
      }),
    );
    expect(h.w.document.activeElement).toBe(close);
    close.dispatchEvent(
      new h.w.KeyboardEvent("keydown", {
        key: "Tab",
        shiftKey: true,
        bubbles: true,
        cancelable: true,
      }),
    );
    expect(h.w.document.activeElement).toBe(last);
    close.click();
    expect(prompt.inert).toBe(false);
    expect(h.w.document.activeElement).toBe(h.editor);
    const error = "完整错误信息".repeat(50);
    h.events.onOperationError!(error);
    expect(h.status.title).toBe(error);
    expect(h.status.tabIndex).toBe(0);
    h.status.click();
    expect(h.status.classList.contains("is-expanded")).toBe(true);
  });

  it("handles failed health IPC without an unhandled rejection", async () => {
    const h = await ui({
      optimizer: {
        health: vi.fn(async () => {
          throw new Error("服务不可达");
        }),
        optimize: vi.fn(),
      },
    });
    expect(h.status.textContent).toBe("服务不可达");
  });
});
