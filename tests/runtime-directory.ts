import { mkdirSync, mkdtempSync } from "node:fs";
import path from "node:path";

export function runtimeDirectory(prefix: string): string {
  const root = path.resolve(".work", "tests");
  mkdirSync(root, { recursive: true });
  return mkdtempSync(path.join(root, prefix));
}
