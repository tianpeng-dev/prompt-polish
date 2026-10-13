export const MAX_INPUT_CHARS = 2_000;

export function validateInput(value: unknown): string {
  if (typeof value !== "string") throw new TypeError("input 必须是字符串。");
  const trimmed = value.trim();
  if (!trimmed) throw new RangeError("请输入需要优化的内容。");
  if (value.length > MAX_INPUT_CHARS) {
    throw new RangeError(`输入内容不能超过 ${MAX_INPUT_CHARS} 个字符。`);
  }
  return trimmed;
}
