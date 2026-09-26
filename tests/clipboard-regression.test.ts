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
