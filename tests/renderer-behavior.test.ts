import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { JSDOM } from "jsdom";
import { readFile } from "node:fs/promises";
import { build } from "esbuild";
import type { DesktopBridge } from "../desktop/types.js";
import {
  createClipboardController,
  DEFAULT_SETTINGS,
} from "../desktop/logic.js";
import {
  generateThinkingPrompt,
  THINKING_METHODS,
} from "../src/thinking-methods.js";
import { VIEW_HEIGHTS } from "../desktop/window-layout.js";

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
  vi.useRealTimers();
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
  // IPC、Trae 与设置以明确的隔离适配器运行；模板与剪贴板归属逻辑使用真实实现。
  let clipboardText = "之前复制的内容";
  const clipboard = createClipboardController({
    clipboard: {
      readText: () => clipboardText,
      writeText: (value) => {
        clipboardText = value;
      },
    },
    optimize: async () => response(),
  });
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
      copy: vi.fn(async (text: string) => clipboard.copy(text)),
      optimize: vi.fn(async (source: string) => ({
        source,
        response: response(),
        operationId: 1,
        clipboardUpdated: true,
      })),
      undo: vi.fn(async (id?: number) => clipboard.undo(id)),
    },
    settings: {
      get: vi.fn(async () => snapshot),
      update: vi.fn(async (update) => ({
        ...snapshot,
        settings: { ...snapshot.settings, ...update },
      })),
    },
    thinking: {
      copy: vi.fn(async (source: string, methodId: string) => {
        const response = generateThinkingPrompt(source, methodId);
        return { response, methodId, ...clipboard.copy(response.optimized) };
      }),
    },
    auth: { login: vi.fn(async () => ({ ok: true, authenticated: true })) },
    window: {
      hide: vi.fn(async () => {}),
      setView: vi.fn(async (view: keyof typeof VIEW_HEIGHTS) => ({
        view,
        side: "below",
        height: VIEW_HEIGHTS[view],
      })),
    } as any,
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
    "onLayoutChanged",
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
  return {
    w,
    events,
    bridge,
    editor,
    action,
    status,
    input,
    key,
    clipboardText: () => clipboardText,
    externalCopy: (text: string) => {
      clipboardText = text;
    },
  };
}

describe("renderer behavior with the real compiled UI", () => {
  async function choose(h: Awaited<ReturnType<typeof ui>>, id: string) {
    h.w.document.querySelector<HTMLButtonElement>("#method-trigger")!.click();
    await tick();
    h.w.document
      .querySelector<HTMLButtonElement>(`[data-method="${id}"]`)!
      .click();
    await tick();
  }

  it("copies all 12 methods in one click while offline and preserves the visible draft", async () => {
    const h = await ui({
      optimizer: {
        health: vi.fn(
          async () =>
            ({ ok: false, authenticated: false, error: "离线" }) as any,
        ),
        optimize: vi.fn(),
      },
    });
    const source = "我想了解数据库索引的使用边界";
    h.input(source);
    for (const method of THINKING_METHODS) {
      await choose(h, method.id);
      expect(h.editor.value).toBe(source);
      expect(h.clipboardText()).toBe(
        generateThinkingPrompt(source, method.id).optimized,
      );
      expect(h.status.textContent).toBe(`已复制 · ${method.name}`);
      expect(h.action.dataset.mode).toBe("optimize");
      expect(h.action.textContent).toContain("优化");
    }
    expect(h.bridge.thinking.copy).toHaveBeenCalledTimes(12);
    expect(h.bridge.optimizer.optimize).not.toHaveBeenCalled();
    expect(h.bridge.clipboard.optimize).not.toHaveBeenCalled();
    expect(h.bridge.clipboard.copy).not.toHaveBeenCalled();
  });

  it("always uses visible text and preserves the editor selection and optimization undo", async () => {
    const h = await ui();
    h.input("解释数据库索引");
    h.editor.setSelectionRange(2, 5);
    await choose(h, "dual-layer");
    expect(h.editor.selectionStart).toBe(2);
    expect(h.editor.selectionEnd).toBe(5);
    const first = h.clipboardText();
    await choose(h, "first-principles");
    expect(h.clipboardText()).not.toContain(first);
    expect(h.bridge.thinking.copy).toHaveBeenLastCalledWith(
      "解释数据库索引",
      "first-principles",
    );
    h.action.click();
    await tick();
    expect(h.editor.value).toBe("优化结果");
    await choose(h, "experiment");
    expect(h.bridge.thinking.copy).toHaveBeenLastCalledWith(
      "优化结果",
      "experiment",
    );
    expect(h.editor.value).toBe("优化结果");
    expect(h.action.dataset.mode).toBe("undo");
    h.action.click();
    await tick();
    expect(h.editor.value).toBe("解释数据库索引");
  });

  it("copies generic templates and long visible drafts without widening Trae input limits", async () => {
    const h = await ui();
    await choose(h, "socratic");
    expect(h.editor.value).toBe("");
    expect(h.clipboardText()).toContain("请先询问");
    h.input("字".repeat(3000));
    await choose(h, "dual-layer");
    expect(h.editor.value.length).toBe(3000);
    expect(h.clipboardText()).toBe(
      generateThinkingPrompt(h.editor.value, "dual-layer").optimized,
    );
    expect(h.action.disabled).toBe(true);
    h.key("Enter");
    await tick();
    expect(h.bridge.optimizer.optimize).not.toHaveBeenCalled();
    expect(h.bridge.thinking.copy).toHaveBeenCalledTimes(2);
  });

  it("keeps keyboard menu navigation, selection, escape and focus return functional", async () => {
    const h = await ui();
    const trigger =
      h.w.document.querySelector<HTMLButtonElement>("#method-trigger")!;
    trigger.click();
    await tick();
    const first = h.w.document.querySelector<HTMLElement>(
      '[data-method="socratic"]',
    )!;
    expect(h.w.document.activeElement).toBe(first);
    expect(h.w.document.querySelectorAll(".method-option")).toHaveLength(12);
    expect(h.w.document.querySelector("[aria-checked]")).toBeNull();
    first.dispatchEvent(
      new h.w.KeyboardEvent("keydown", {
        key: "End",
        bubbles: true,
        cancelable: true,
      }),
    );
    expect((h.w.document.activeElement as HTMLElement).dataset.method).toBe(
      "life-design",
    );
    h.w.document.activeElement!.dispatchEvent(
      new h.w.KeyboardEvent("keydown", {
        key: "Enter",
        bubbles: true,
        cancelable: true,
        isComposing: true,
      }),
    );
    expect(h.bridge.thinking.copy).not.toHaveBeenCalled();
    h.w.document.activeElement!.dispatchEvent(
      new h.w.KeyboardEvent("keydown", {
        key: "Enter",
        bubbles: true,
        cancelable: true,
      }),
    );
    await tick();
    expect(h.w.document.activeElement).toBe(h.editor);
    expect(h.bridge.thinking.copy).toHaveBeenCalledWith("", "life-design");
    trigger.click();
    await tick();
    h.w.document.activeElement!.dispatchEvent(
      new h.w.KeyboardEvent("keydown", {
        key: "Escape",
        bubbles: true,
        cancelable: true,
      }),
    );
    await tick();
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    expect(h.editor.value).toBe("");
    expect(h.bridge.window.hide).not.toHaveBeenCalled();
  });

  it("uses Trae for the clipboard shortcut and restores the prior draft", async () => {
    const h = await ui();
    await choose(h, "dual-layer");
    h.input("学习草稿");
    h.events.onShortcutOptimizeRequested!("剪贴板源");
    await tick();
    expect(h.bridge.thinking.copy).toHaveBeenCalledTimes(1);
    expect(h.bridge.clipboard.optimize).toHaveBeenCalledWith("剪贴板源");
    h.action.click();
    await tick();
    expect(h.editor.value).toBe("学习草稿");
    expect(h.action.textContent).toContain("优化");
  });

  it("restores failed setting values, offers an actual retry and handles incomplete shortcut capture", async () => {
    const update = vi
      .fn()
      .mockRejectedValueOnce(new Error("保存权限不足"))
      .mockResolvedValue({
        platform: "darwin",
        settings: { ...DEFAULT_SETTINGS, launchAtLogin: false },
        shortcutRegistered: true,
        shortcutError: null,
      });
    const h = await ui({
      settings: {
        get: vi.fn(async () => ({
          platform: "darwin" as const,
          settings: { ...DEFAULT_SETTINGS },
          shortcutRegistered: true,
          shortcutError: null,
        })),
        update,
      },
    });
    h.events.onOpenSettings!();
    await tick();
    const launch =
      h.w.document.querySelector<HTMLInputElement>("#launch-toggle")!;
    launch.checked = false;
    launch.dispatchEvent(new h.w.Event("change", { bubbles: true }));
    await tick();
    expect(launch.checked).toBe(true);
    const retry =
      h.w.document.querySelector<HTMLButtonElement>("#settings-retry")!;
    expect(retry.hidden).toBe(false);
    retry.click();
    await tick();
    expect(launch.checked).toBe(false);
    expect(update.mock.calls).toEqual([
      [{ launchAtLogin: false }],
      [{ launchAtLogin: false }],
    ]);
    const recorder =
      h.w.document.querySelector<HTMLButtonElement>("#shortcut-recorder")!;
    recorder.click();
    recorder.dispatchEvent(
      new h.w.KeyboardEvent("keydown", {
        key: "Meta",
        metaKey: true,
        bubbles: true,
        cancelable: true,
      }),
    );
    expect(update).toHaveBeenCalledTimes(2);
    expect(
      h.w.document.querySelector("#settings-status")!.textContent,
    ).toContain("修饰键");
    recorder.dispatchEvent(
      new h.w.KeyboardEvent("keydown", {
        key: "Escape",
        bubbles: true,
        cancelable: true,
      }),
    );
    expect(
      h.w.document.querySelector<HTMLElement>("#settings-panel")!.hidden,
    ).toBe(false);
  });

  it("preserves the editor after login cancellation and keeps method copying available", async () => {
    const h = await ui({
      optimizer: {
        health: vi.fn(async () => ({ ok: false, authenticated: false }) as any),
        optimize: vi.fn(),
      },
      auth: {
        login: vi.fn(async () => {
          throw new Error("已取消 Trae 登录。");
        }),
      },
    });
    await choose(h, "experiment");
    h.input("验证学习计划");
    h.w.document
      .querySelector<HTMLButtonElement>("#connection-button")!
      .click();
    await tick();
    expect(h.editor.value).toBe("验证学习计划");
    expect(h.action.disabled).toBe(false);
    await choose(h, "experiment");
    expect(h.clipboardText()).toContain("低成本、可逆");
    expect(h.editor.value).toBe("验证学习计划");
  });

  it("keeps error detail in its own view and retries the original operation", async () => {
    const optimize = vi
      .fn()
      .mockRejectedValueOnce(new Error("网络不可用"))
      .mockResolvedValue(response());
    const h = await ui({
      optimizer: { health: vi.fn(async () => ({ ok: true }) as any), optimize },
    });
    h.input("原始草稿");
    h.action.click();
    await tick();
    h.status.click();
    await tick();
    expect(
      h.w.document.querySelector<HTMLElement>("#detail-panel")!.hidden,
    ).toBe(false);
    expect(h.w.document.querySelector("#detail-message")!.textContent).toBe(
      "网络不可用",
    );
    expect(h.editor.value).toBe("原始草稿");
    h.w.document.querySelector<HTMLButtonElement>("#detail-retry")!.click();
    await tick();
    expect(optimize).toHaveBeenCalledTimes(2);
    expect(h.editor.value).toBe("优化结果");
  });

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
    const h = await ui({
      clipboard: {
        optimize,
        undo,
        copy: vi.fn(async () => ({ operationId: 1 })),
      },
    });
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
        copy: vi.fn(async () => ({ operationId: 1 })),
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
    await tick();
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
    await tick();
    expect(prompt.inert).toBe(false);
    expect(h.w.document.activeElement).toBe(h.editor);
    const error = "完整错误信息".repeat(50);
    h.events.onOperationError!(error);
    expect(h.status.title).toBe(error);
    expect(h.status.tabIndex).toBe(0);
    h.status.click();
    await tick();
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

  it("uses Windows shortcut labels and Ctrl Z for one-step undo", async () => {
    const h = await ui();
    h.events.onSettingsChanged!({
      platform: "win32",
      settings: { ...DEFAULT_SETTINGS },
      shortcutRegistered: true,
      shortcutError: null,
    });
    h.input("原始输入");
    h.key("Enter");
    await tick();
    expect(h.w.document.querySelector("#action-key")!.textContent).toBe(
      "Ctrl+Z",
    );
    h.key("z", { ctrlKey: true });
    await tick();
    expect(h.editor.value).toBe("原始输入");
    expect(h.action.dataset.mode).toBe("optimize");
  });

  it("retains the draft and optimization metadata across method copying and blank recovery", async () => {
    const h = await ui();
    const original = "解释索引的边界";
    h.input(original);
    await choose(h, "dual-layer");
    h.events.onBlankRequested!();
    h.action.click();
    await tick();
    expect(h.editor.value).toBe(original);
    await choose(h, "first-principles");
    expect(h.editor.value).toBe(original);
    expect(h.bridge.thinking.copy).toHaveBeenLastCalledWith(
      original,
      "first-principles",
    );
  });

  it("preserves a long visible draft after clipboard optimization undo and method copying", async () => {
    const h = await ui();
    const original = "字".repeat(3000);
    h.input(original);
    await choose(h, "socratic");
    h.events.onBlankRequested!();
    h.action.click();
    await tick();
    expect(h.editor.value).toBe(original);
    expect(h.action.disabled).toBe(true);
    h.events.onShortcutOptimizeRequested!("剪贴板内容");
    await tick();
    h.action.click();
    await tick();
    expect(h.editor.value).toBe(original);
    await choose(h, "experiment");
    expect(h.editor.value).toBe(original);
  });

  it("previews the copied prompt without replacing the draft and undoes only the clipboard", async () => {
    const h = await ui();
    h.input("人生的意义");
    await choose(h, "socratic");
    const copied = h.clipboardText();
    h.w.document.querySelector<HTMLButtonElement>("#method-copy-view")!.click();
    await tick();
    expect(h.w.document.querySelector("#detail-title")!.textContent).toBe(
      "提示词预览",
    );
    expect(h.w.document.querySelector("#detail-message")!.textContent).toBe(
      copied,
    );
    expect(h.w.document.querySelectorAll("textarea")).toHaveLength(1);
    expect(h.editor.value).toBe("人生的意义");
    h.w.document.querySelector<HTMLButtonElement>("#detail-copy")!.click();
    await tick();
    expect(h.clipboardText()).toBe(copied);
    h.w.document.querySelector<HTMLButtonElement>("#detail-close")!.click();
    await tick();
    h.w.document.querySelector<HTMLButtonElement>("#method-copy-undo")!.click();
    await tick();
    expect(h.clipboardText()).toBe("之前复制的内容");
    expect(h.editor.value).toBe("人生的意义");
    expect(h.action.dataset.mode).toBe("optimize");
  });

  it("updates clipboard undo ownership when recopying the preview after an external copy", async () => {
    const h = await ui();
    h.input("当前问题");
    await choose(h, "dual-layer");
    h.externalCopy("外部新内容");
    h.w.document.querySelector<HTMLButtonElement>("#method-copy-view")!.click();
    await tick();
    h.w.document.querySelector<HTMLButtonElement>("#detail-copy")!.click();
    await tick();
    h.w.document.querySelector<HTMLButtonElement>("#detail-close")!.click();
    await tick();
    h.w.document.querySelector<HTMLButtonElement>("#method-copy-undo")!.click();
    await tick();
    expect(h.clipboardText()).toBe("外部新内容");
    expect(h.editor.value).toBe("当前问题");
  });

  it("protects later copies and ignores unrelated tray undo events", async () => {
    const h = await ui();
    h.input("问题正文");
    await choose(h, "socratic");
    h.events.onClipboardRestored!({ restored: true, operationId: 999 });
    expect(
      h.w.document.querySelector<HTMLElement>("#method-copy-actions")!.hidden,
    ).toBe(false);
    h.externalCopy("后来复制的文字");
    h.w.document.querySelector<HTMLButtonElement>("#method-copy-undo")!.click();
    await tick();
    expect(h.clipboardText()).toBe("后来复制的文字");
    expect(h.editor.value).toBe("问题正文");
    expect(h.status.textContent).toContain("未修改");
  });

  it("retains draft and clipboard and displays the actual copy failure inside the method panel", async () => {
    const copy = vi.fn(async () => {
      throw new Error("隔离 IPC 的剪贴板权限错误");
    });
    const h = await ui({ thinking: { copy } });
    h.input("不要丢失正文");
    await choose(h, "experiment");
    expect(h.editor.value).toBe("不要丢失正文");
    expect(h.clipboardText()).toBe("之前复制的内容");
    expect(
      h.w.document.querySelector<HTMLElement>("#method-panel")!.hidden,
    ).toBe(false);
    expect(
      h.w.document.querySelector("#method-description")!.textContent,
    ).toContain("剪贴板权限错误");
    expect(
      h.w.document.querySelector<HTMLButtonElement>(".method-option")!.disabled,
    ).toBe(false);
  });

  it("prevents duplicate method operations and keeps blank and shortcut requests from changing the busy draft", async () => {
    let resolve!: (value: any) => void;
    const copy = vi.fn(
      () =>
        new Promise<any>((r) => {
          resolve = r;
        }),
    );
    const h = await ui({ thinking: { copy } });
    h.input("当前问题");
    await choose(h, "dual-layer");
    expect(h.editor.readOnly).toBe(true);
    h.w.document
      .querySelector<HTMLButtonElement>('[data-method="socratic"]')!
      .click();
    h.events.onBlankRequested!();
    h.events.onShortcutOptimizeRequested!("其他内容");
    expect(copy).toHaveBeenCalledTimes(1);
    expect(h.editor.value).toBe("当前问题");
    resolve({
      methodId: "dual-layer",
      response: generateThinkingPrompt("当前问题", "dual-layer"),
      operationId: 7,
    });
    await tick();
    expect(h.editor.readOnly).toBe(false);
    expect(h.editor.value).toBe("当前问题");
  });

  it("keeps keyboard focus inside the palette and uses two-column arrow navigation", async () => {
    const h = await ui();
    h.input("保留光标位置");
    h.editor.setSelectionRange(1, 3);
    h.w.document.querySelector<HTMLButtonElement>("#method-trigger")!.click();
    await tick();
    const key = (key: string, init: KeyboardEventInit = {}) =>
      h.w.document.activeElement!.dispatchEvent(
        new h.w.KeyboardEvent("keydown", {
          key,
          bubbles: true,
          cancelable: true,
          ...init,
        }),
      );
    key("ArrowDown");
    expect((h.w.document.activeElement as HTMLElement).dataset.method).toBe(
      "reverse",
    );
    key("ArrowRight");
    expect((h.w.document.activeElement as HTMLElement).dataset.method).toBe(
      "axes",
    );
    key("ArrowUp");
    expect((h.w.document.activeElement as HTMLElement).dataset.method).toBe(
      "dual-layer",
    );
    key("Tab");
    expect(h.w.document.activeElement!.id).toBe("method-close");
    key("Tab", { shiftKey: true });
    expect((h.w.document.activeElement as HTMLElement).dataset.method).toBe(
      "dual-layer",
    );
    key("Escape");
    await tick();
    expect(h.w.document.activeElement).toBe(h.editor);
    expect(h.editor.selectionStart).toBe(1);
    expect(h.editor.selectionEnd).toBe(3);
    expect(h.clipboardText()).toBe("之前复制的内容");
  });

  it("hides after confirmation only when unpinned and cancels hiding on new user interaction", async () => {
    const h = await ui();
    vi.useFakeTimers();
    const settings = { ...DEFAULT_SETTINGS, alwaysOnTop: false };
    h.events.onSettingsChanged!({
      platform: "darwin",
      settings,
      shortcutRegistered: true,
      shortcutError: null,
    });
    const chooseTimed = async () => {
      h.w.document.querySelector<HTMLButtonElement>("#method-trigger")!.click();
      await Promise.resolve();
      await Promise.resolve();
      h.w.document
        .querySelector<HTMLButtonElement>('[data-method="socratic"]')!
        .click();
      await vi.advanceTimersByTimeAsync(0);
    };
    await chooseTimed();
    await vi.advanceTimersByTimeAsync(799);
    expect(h.bridge.window.hide).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(h.bridge.window.hide).toHaveBeenCalledTimes(1);
    await chooseTimed();
    h.key("a");
    await vi.advanceTimersByTimeAsync(1000);
    expect(h.bridge.window.hide).toHaveBeenCalledTimes(1);
    h.events.onSettingsChanged!({
      platform: "darwin",
      settings: { ...settings, alwaysOnTop: true },
      shortcutRegistered: true,
      shortcutError: null,
    });
    await chooseTimed();
    await vi.advanceTimersByTimeAsync(1000);
    expect(h.bridge.window.hide).toHaveBeenCalledTimes(1);
  });

  it("renders successful operation details with the actual status tone and no retry", async () => {
    const h = await ui();
    h.input("原始输入");
    h.action.click();
    await tick();
    h.status.click();
    await tick();
    expect(
      h.w.document.querySelector<HTMLElement>("#detail-message")!.dataset.tone,
    ).toBe("ready");
    expect(
      h.w.document.querySelector<HTMLButtonElement>("#detail-retry")!.hidden,
    ).toBe(true);
    expect(h.w.document.querySelector(".detail-hint")!.textContent).toBe(
      "关闭详情后可继续编辑。",
    );
  });
});
