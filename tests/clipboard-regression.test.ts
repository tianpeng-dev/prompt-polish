import { describe, expect, it, vi } from "vitest";
import { createClipboardController } from "../desktop/logic.js";
import type { OptimizeResponse } from "../src/types.js";
const result = (text: string): OptimizeResponse => ({
  optimized: text,
  metrics: {
    inputChars: 1,
    outputChars: 1,
    expansionRatio: 1,
    durationMs: 1,
    tokenUsage: 1,
  },
  traceId: "synthetic",
});
describe("clipboard ownership", () => {
  it("copies explicit method prompts and conditionally restores the previous clipboard", () => {
    let text = "复制前的内容";
    const controller = createClipboardController({
      clipboard: {
        readText: () => text,
        writeText: (value) => {
          text = value;
        },
      },
      optimize: vi.fn(),
    });
    const first = controller.copy("方法提示词");
    expect(controller.copy("方法提示词")).toEqual(first);
    expect(text).toBe("方法提示词");
    expect(controller.canUndo()).toBe(true);
    text = "后来复制的内容";
    expect(controller.undo(first.operationId)).toMatchObject({
      restored: false,
      conflict: true,
    });
    expect(text).toBe("后来复制的内容");
    const next = controller.copy("另一种方法");
    expect(controller.undo(first.operationId)).toMatchObject({
      conflict: true,
    });
    expect(controller.undo(next.operationId)).toMatchObject({
      restored: true,
      text: "后来复制的内容",
    });
    expect(text).toBe("后来复制的内容");
    expect(controller.canUndo()).toBe(false);
  });

  it("preserves clipboard and undo ownership on failed copy or invalid payload", () => {
    let text = "原剪贴板";
    let fail = false;
    const controller = createClipboardController({
      clipboard: {
        readText: () => text,
        writeText: (value) => {
          if (fail) throw new Error("明确标识的剪贴板写入故障");
          text = value;
        },
      },
      optimize: vi.fn(),
    });
    const first = controller.copy("第一次复制");
    for (const value of [null, {}, "", "x".repeat(10001)])
      expect(() => controller.copy(value)).toThrow("复制内容无效");
    fail = true;
    expect(() => controller.copy("第二次复制")).toThrow("剪贴板写入故障");
    expect(text).toBe("第一次复制");
    fail = false;
    expect(controller.undo(first.operationId).restored).toBe(true);
    expect(text).toBe("原剪贴板");
  });
  it("does not overwrite a newer copy while awaiting the backend", async () => {
    let text = "  source  ";
    let resolve!: (response: OptimizeResponse) => void;
    const writeText = vi.fn((value) => {
      text = value;
    });
    const controller = createClipboardController({
      clipboard: { readText: () => text, writeText },
      optimize: () =>
        new Promise((r) => {
          resolve = r;
        }),
    });
    const pending = controller.optimize(text);
    expect(() => controller.copy("同时复制")).toThrow("正在处理");
    await expect(controller.optimize()).rejects.toThrow("正在处理");
    text = "new copy";
    resolve(result("output"));
    expect(await pending).toMatchObject({
      source: "  source  ",
      clipboardUpdated: false,
    });
    expect(text).toBe("new copy");
    expect(writeText).not.toHaveBeenCalled();
  });
  it("restores exact whitespace and refuses stale undo or changed clipboard", async () => {
    let text = "  source  ";
    const controller = createClipboardController({
      clipboard: {
        readText: () => text,
        writeText: (v) => {
          text = v;
        },
      },
      optimize: async () => result("output"),
    });
    const first = await controller.optimize();
    expect(controller.undo(first.operationId + 1)).toMatchObject({
      restored: false,
      conflict: true,
    });
    text = "new copy";
    expect(controller.undo(first.operationId)).toMatchObject({
      restored: false,
      conflict: true,
    });
    expect(controller.canUndo()).toBe(false);
    text = "output";
    expect(controller.undo(first.operationId)).toMatchObject({
      restored: true,
      text: "  source  ",
    });
  });
  it("rejects a source changed before the operation starts", async () => {
    const optimize = vi.fn();
    const controller = createClipboardController({
      clipboard: { readText: () => "current", writeText: vi.fn() },
      optimize,
    });
    await expect(controller.optimize("old")).rejects.toThrow("剪贴板已变化");
    expect(optimize).not.toHaveBeenCalled();
  });
});
