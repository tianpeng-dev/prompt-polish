import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { PROJECT_ROOT } from "../src/paths.js";

describe("Trae optimizer prompt contract", () => {
  it("uses the Trae CN input-optimization template", async () => {
    const prompt = await readFile(
      path.join(PROJECT_ROOT, "prompts", "trae-cn-input-optimization.md"),
      "utf8",
    );
    expect(prompt).toContain("You are Trae AI");
    expect(prompt).toContain("instruction expansion and enhancement");
    expect(prompt).toContain("placeholder_map");
    expect(prompt).toContain(
      "Output language MUST match the `user_input` language",
    );
    expect(prompt).not.toContain("⟦PROTECTED_");
    expect(prompt).not.toContain("gpt-5.6-sol");
  });
});
