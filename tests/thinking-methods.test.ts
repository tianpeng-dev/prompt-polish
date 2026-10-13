import { describe, expect, it } from "vitest";
import {
  METHOD_GROUPS,
  THINKING_METHODS,
  generateThinkingPrompt,
  requireThinkingMethod,
} from "../src/thinking-methods.js";
import {
  calculateViewBounds,
  compactAnchor,
  validateWindowView,
} from "../desktop/window-layout.js";

describe("local thinking methods", () => {
  it("covers 12 unique methods in five groups with independent instructions", () => {
    expect(THINKING_METHODS).toHaveLength(12);
    expect(new Set(THINKING_METHODS.map((method) => method.id)).size).toBe(12);
    expect(
      METHOD_GROUPS.map(
        (group) =>
          THINKING_METHODS.filter((method) => method.group === group).length,
      ),
    ).toEqual([1, 4, 3, 2, 2]);
    for (const method of THINKING_METHODS) {
      expect(method.zh.length).toBeGreaterThan(70);
      expect(method.en.length).toBeGreaterThan(100);
    }
  });

  it.each(THINKING_METHODS.map((method) => [method.id]))(
    "preserves exact source in %s without a model or placeholder substitution",
    (id) => {
      const source =
        '  核查 2026 年 ${security_standard} 与 /Users/demo/app.ts\n```ts\nconst a = "⟦PROTECTED_000⟧";\n```\n';
      const result = generateThinkingPrompt(source, id);
      expect(result.optimized.endsWith(source)).toBe(true);
      expect(result.traceId).toBe(`local:${id}`);
      expect(result.metrics.inputChars).toBe(source.length);
      expect(result.metrics.outputChars).toBe(result.optimized.length);
      expect(result.metrics.tokenUsage).toBeNull();
      expect(result.optimized.length - source.length).toBeLessThan(600);
    },
  );

  it("uses English instructions and accepts visible long optimization results", () => {
    const text = "Explain database indexes and their costs";
    const english = generateThinkingPrompt(text, "dual-layer");
    expect(english.optimized).toContain("two layers");
    expect(english.optimized).not.toMatch(/[\p{Script=Han}]/u);
    const long = generateThinkingPrompt("字".repeat(2000), "dual-layer");
    expect(long.optimized.length).toBeGreaterThan(2000);
    expect(
      generateThinkingPrompt("字".repeat(3000), "dual-layer").optimized,
    ).toContain("字".repeat(3000));
    expect(() =>
      generateThinkingPrompt("字".repeat(10001), "dual-layer"),
    ).toThrow("10000");
    expect(() =>
      generateThinkingPrompt("字".repeat(10000), "dual-layer"),
    ).toThrow("组合后的提示词");
  });

  it.each(THINKING_METHODS.map((method) => [method.id]))(
    "copies a usable generic template without input for %s",
    (id) => {
      for (const input of ["", " \n "]) {
        const result = generateThinkingPrompt(input, id);
        expect(result.optimized).toContain("请先询问我希望讨论的问题或材料");
        expect(result.optimized).not.toContain("我的问题与背景：");
        expect(result.metrics.inputChars).toBe(0);
        expect(result.metrics.expansionRatio).toBeNull();
      }
    },
  );

  it("rejects unknown methods and invalid input before generation", () => {
    for (const id of [null, {}, "ordinary", "toString", "__proto__", "unknown"])
      expect(() => requireThinkingMethod(id)).toThrow("方法无效");
    for (const value of [null, 1, {}])
      expect(() => generateThinkingPrompt(value, "socratic")).toThrow();
  });

  it("bounds every interview including follow-ups and leaves resource choices open", () => {
    expect(requireThinkingMethod("socratic").zh).toContain(
      "包含追问在内最多 6",
    );
    expect(requireThinkingMethod("strengths").zh).toContain(
      "包含追问在内最多 10",
    );
    expect(requireThinkingMethod("life-design").zh).toContain(
      "包含追问在内最多 9",
    );
    expect(requireThinkingMethod("experiment").zh).toContain(
      "避免自行设定为事实",
    );
    for (const method of THINKING_METHODS)
      expect(method.zh).not.toMatch(/10000|30000|20年|无限追问/);
  });
});

describe("bounded native window views", () => {
  const area = { x: -1920, y: 24, width: 1920, height: 1000 };
  it("opens downward with sufficient space and upward near the bottom", () => {
    const below = calculateViewBounds({ x: -1000, y: 40 }, area, "methods");
    expect(below).toMatchObject({
      side: "below",
      x: -1000,
      y: 40,
      width: 460,
      height: 320,
    });
    expect(compactAnchor(below, below.side)).toEqual({ x: -1000, y: 40 });
    const above = calculateViewBounds({ x: -1000, y: 820 }, area, "methods");
    expect(above).toMatchObject({ side: "above", y: 676, height: 320 });
    expect(compactAnchor(above, above.side)).toEqual({ x: -1000, y: 820 });
  });
  it("caps expanded views to the real work area and rejects arbitrary sizing", () => {
    const limited = calculateViewBounds(
      { x: 100, y: 200 },
      { x: 0, y: 24, width: 800, height: 280 },
      "methods",
    );
    expect(limited.height).toBe(264);
    expect(limited.y).toBeGreaterThanOrEqual(32);
    expect(limited.y + limited.height).toBeLessThanOrEqual(296);
    for (const view of [null, {}, "__proto__", "640", "constructor"])
      expect(() => validateWindowView(view)).toThrow("窗口视图无效");
    expect(validateWindowView("settings")).toBe("settings");
  });
});
