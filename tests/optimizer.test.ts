import { describe, expect, it } from "vitest";
import { validateInput } from "../src/validation.js";

describe("validateInput", () => {
  it("trims normal input", () => {
    expect(validateInput("  修复登录问题  ")).toBe("修复登录问题");
  });

  it("rejects empty and overlong input", () => {
    expect(() => validateInput("   ")).toThrow("请输入");
    expect(() => validateInput("x".repeat(2001))).toThrow("2000");
    expect(() => validateInput(" ".repeat(2000) + "x")).toThrow("2000");
  });

  it("accepts the exact 2000-character boundary and English input", () => {
    expect(validateInput("x".repeat(2000))).toHaveLength(2000);
    expect(validateInput("  Fix the retry bug.  ")).toBe("Fix the retry bug.");
  });
});
