import type { OptimizeResponse } from "../src/types.js";
import { validateInput } from "../src/validation.js";
import type {
  ClipboardOptimizeResult,
  ClipboardUndoResult,
  DesktopPlatform,
  DesktopSettings,
  SettingsUpdate,
  WindowPosition,
} from "./types.js";

export const DEFAULT_SETTINGS: DesktopSettings = {
  schemaVersion: 2,
  launchAtLogin: true,
  optimizeClipboardOnShortcut: false,
  shortcut: "CommandOrControl+Alt+P",
  alwaysOnTop: true,
  windowPosition: null,
};

export type Rectangle = { x: number; y: number; width: number; height: number };
export type DisplayArea = { id: number; workArea: Rectangle };
type Size = { width: number; height: number };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function normalizeSettings(value: unknown): DesktopSettings {
  if (
    !isRecord(value) ||
    (value.schemaVersion !== 1 && value.schemaVersion !== 2)
  ) {
    return { ...DEFAULT_SETTINGS };
  }
  let shortcut = DEFAULT_SETTINGS.shortcut;
  try {
    shortcut = validateShortcut(value.shortcut);
  } catch {
    // Invalid persisted shortcuts fall back to a known-safe default.
  }
  const position =
    isRecord(value.windowPosition) &&
    Number.isFinite(value.windowPosition.x) &&
    Number.isFinite(value.windowPosition.y)
      ? {
          x: Math.round(value.windowPosition.x as number),
          y: Math.round(value.windowPosition.y as number),
        }
      : null;
  return {
    schemaVersion: 2,
    launchAtLogin:
      typeof value.launchAtLogin === "boolean"
        ? value.launchAtLogin
        : DEFAULT_SETTINGS.launchAtLogin,
    optimizeClipboardOnShortcut:
      typeof value.optimizeClipboardOnShortcut === "boolean"
        ? value.optimizeClipboardOnShortcut
        : DEFAULT_SETTINGS.optimizeClipboardOnShortcut,
    shortcut,
    alwaysOnTop:
      typeof value.alwaysOnTop === "boolean"
        ? value.alwaysOnTop
        : DEFAULT_SETTINGS.alwaysOnTop,
    windowPosition: value.schemaVersion === 2 ? position : null,
  };
}

export function validateSettingsUpdate(value: unknown): SettingsUpdate {
  if (!isRecord(value) || Array.isArray(value)) {
    throw new TypeError("设置内容无效。");
  }
  if (
    value.launchAtLogin !== undefined &&
    typeof value.launchAtLogin !== "boolean"
  ) {
    throw new TypeError("登录启动设置无效。");
  }
  if (
    value.optimizeClipboardOnShortcut !== undefined &&
    typeof value.optimizeClipboardOnShortcut !== "boolean"
  ) {
    throw new TypeError("快捷键自动优化设置无效。");
  }
  if (
    value.alwaysOnTop !== undefined &&
    typeof value.alwaysOnTop !== "boolean"
  ) {
    throw new TypeError("窗口置顶设置无效。");
  }
  return {
    launchAtLogin: value.launchAtLogin as boolean | undefined,
    optimizeClipboardOnShortcut: value.optimizeClipboardOnShortcut as
      boolean | undefined,
    shortcut: value.shortcut as string | undefined,
    alwaysOnTop: value.alwaysOnTop as boolean | undefined,
  };
}

const MODIFIER_ALIASES = new Map([
  ["commandorcontrol", "CommandOrControl"],
  ["cmdorctrl", "CommandOrControl"],
  ["command", "CommandOrControl"],
  ["cmd", "CommandOrControl"],
  ["meta", "CommandOrControl"],
  ["control", "Control"],
  ["ctrl", "Control"],
  ["alt", "Alt"],
  ["option", "Alt"],
  ["shift", "Shift"],
]);

const MODIFIER_ORDER = ["CommandOrControl", "Control", "Alt", "Shift"];

export function validateShortcut(value: unknown): string {
  if (typeof value !== "string") {
    throw new TypeError("快捷键必须是字符串。");
  }
  const parts = value
    .split("+")
    .map((part) => part.trim())
    .filter(Boolean);
  const modifiers = new Set<string>();
  const keys: string[] = [];

  for (const part of parts) {
    const modifier = MODIFIER_ALIASES.get(part.toLowerCase());
    if (modifier) {
      modifiers.add(modifier);
    } else {
      keys.push(part.toUpperCase());
    }
  }

  if (keys.length !== 1 || !/^(?:[A-Z0-9]|F(?:[1-9]|1\d|20))$/.test(keys[0]!)) {
    throw new RangeError("快捷键需要且只能包含一个字母、数字或功能键。");
  }
  const primaryModifier = modifiers.has("CommandOrControl")
    ? "CommandOrControl"
    : modifiers.has("Control")
      ? "Control"
      : null;
  if (!primaryModifier) {
    throw new RangeError("快捷键必须包含 Command 或 Ctrl。");
  }
  const additionalModifiers =
    primaryModifier === "CommandOrControl"
      ? ["Control", "Alt", "Shift"]
      : ["Alt", "Shift"];
  if (!additionalModifiers.some((item) => modifiers.has(item))) {
    throw new RangeError("请再加入 Alt、Control 或 Shift。");
  }

  return [
    ...MODIFIER_ORDER.filter((modifier) => modifiers.has(modifier)),
    keys[0],
  ].join("+");
}

export function formatShortcut(
  value: string,
  platform: DesktopPlatform = "darwin",
): string {
  const tokens = validateShortcut(value).split("+");
  const key = tokens.at(-1) ?? "";
  if (platform !== "darwin") {
    const labels = [
      tokens.includes("CommandOrControl") || tokens.includes("Control")
        ? "Ctrl"
        : null,
      tokens.includes("Alt") ? "Alt" : null,
      tokens.includes("Shift") ? "Shift" : null,
      key,
    ].filter(Boolean);
    return labels.join("+");
  }
  const symbols = [
    ["Control", "⌃"],
    ["Alt", "⌥"],
    ["Shift", "⇧"],
    ["CommandOrControl", "⌘"],
  ]
    .filter(([modifier]) => tokens.includes(modifier))
    .map(([, symbol]) => symbol)
    .join("");
  return `${symbols}${key}`;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(Math.max(value, minimum), Math.max(minimum, maximum));
}

export function calculateWindowPosition(
  trayBounds: Rectangle,
  workArea: Rectangle,
  windowSize: Size,
  gap = 8,
): { x: number; y: number } {
  const centeredX = Math.round(
    trayBounds.x + trayBounds.width / 2 - windowSize.width / 2,
  );
  const centeredY = Math.round(
    trayBounds.y + trayBounds.height / 2 - windowSize.height / 2,
  );
  let x = clamp(
    centeredX,
    workArea.x + gap,
    workArea.x + workArea.width - windowSize.width - gap,
  );

  const belowTray = trayBounds.y + trayBounds.height + gap;
  const aboveTray = trayBounds.y - windowSize.height - gap;
  const preferredY =
    belowTray + windowSize.height <= workArea.y + workArea.height
      ? belowTray
      : aboveTray;
  let y = clamp(
    preferredY,
    workArea.y + gap,
    workArea.y + workArea.height - windowSize.height - gap,
  );

  if (trayBounds.x >= workArea.x + workArea.width) {
    x = workArea.x + workArea.width - windowSize.width - gap;
    y = clamp(
      centeredY,
      workArea.y + gap,
      workArea.y + workArea.height - windowSize.height - gap,
    );
  } else if (trayBounds.x + trayBounds.width <= workArea.x) {
    x = workArea.x + gap;
    y = clamp(
      centeredY,
      workArea.y + gap,
      workArea.y + workArea.height - windowSize.height - gap,
    );
  }
  return { x, y };
}

export function rectangleIntersectionArea(
  first: Rectangle,
  second: Rectangle,
): number {
  const width = Math.max(
    0,
    Math.min(first.x + first.width, second.x + second.width) -
      Math.max(first.x, second.x),
  );
  const height = Math.max(
    0,
    Math.min(first.y + first.height, second.y + second.height) -
      Math.max(first.y, second.y),
  );
  return width * height;
}

export function selectDisplayForBounds(
  bounds: Rectangle,
  displays: DisplayArea[],
  primaryDisplayId: number,
): DisplayArea | null {
  let selected: DisplayArea | null = null;
  let selectedArea = 0;
  for (const display of displays) {
    const area = rectangleIntersectionArea(bounds, display.workArea);
    if (area > selectedArea) {
      selected = display;
      selectedArea = area;
    }
  }
  if (selected) return selected;
  return (
    displays.find((display) => display.id === primaryDisplayId) ??
    displays[0] ??
    null
  );
}

export function constrainWindowPosition(
  bounds: Rectangle,
  workArea: Rectangle,
  snapThreshold = 16,
  inset = 8,
): WindowPosition {
  const minimumX = workArea.x + inset;
  const maximumX = workArea.x + workArea.width - bounds.width - inset;
  const minimumY = workArea.y + inset;
  const maximumY = workArea.y + workArea.height - bounds.height - inset;
  const workAreaRight = workArea.x + workArea.width;
  const workAreaBottom = workArea.y + workArea.height;

  let x = Math.round(bounds.x);
  let y = Math.round(bounds.y);
  if (Math.abs(bounds.x - workArea.x) <= snapThreshold) {
    x = minimumX;
  } else if (
    Math.abs(bounds.x + bounds.width - workAreaRight) <= snapThreshold
  ) {
    x = maximumX;
  } else {
    x = clamp(x, minimumX, maximumX);
  }
  if (Math.abs(bounds.y - workArea.y) <= snapThreshold) {
    y = minimumY;
  } else if (
    Math.abs(bounds.y + bounds.height - workAreaBottom) <= snapThreshold
  ) {
    y = maximumY;
  } else {
    y = clamp(y, minimumY, maximumY);
  }
  return { x, y };
}

export function shouldHideWindowOnBlur(
  alwaysOnTop: boolean,
  devToolsOpen: boolean,
): boolean {
  return !alwaysOnTop && !devToolsOpen;
}

export function desktopPlatform(value: NodeJS.Platform): DesktopPlatform {
  if (value === "darwin" || value === "win32") return value;
  return "other";
}

export function loginItemSettings(
  platform: DesktopPlatform,
  launchAtLogin: boolean,
  executablePath: string,
) {
  if (platform === "darwin") {
    return { openAtLogin: launchAtLogin, type: "mainAppService" as const };
  }
  return {
    openAtLogin: launchAtLogin,
    path: executablePath,
    args: ["--hidden"],
    enabled: launchAtLogin,
    name: "精炼台",
  };
}

export function trayIconName(platform: DesktopPlatform): string {
  return platform === "darwin" ? "tray-iconTemplate.png" : "tray-icon-win.png";
}

export function shouldShowWindowAtStartup(
  platform: DesktopPlatform,
  argv: string[],
  wasOpenedAtLogin: boolean,
): boolean {
  if (platform === "win32") return !argv.includes("--hidden");
  if (platform === "darwin") return !wasOpenedAtLogin;
  return true;
}

export type ClipboardAdapter = {
  readText(): string;
  writeText(value: string): void;
};

export function createClipboardController(dependencies: {
  clipboard: ClipboardAdapter;
  optimize(input: string): Promise<OptimizeResponse>;
}) {
  let sequence = 0;
  let undoEntry: {
    source: string;
    output: string;
    operationId: number;
  } | null = null;
  let running = false;

  return {
    async optimize(expectedSource?: string): Promise<ClipboardOptimizeResult> {
      if (running) throw new Error("正在处理另一项优化，请稍候。");
      const source = dependencies.clipboard.readText();
      if (expectedSource !== undefined && source !== expectedSource)
        throw new TypeError("剪贴板已变化，请重新触发优化。");
      const validated = validateInput(source);
      running = true;
      const operationId = ++sequence;
      try {
        const response = await dependencies.optimize(validated);
        if (!response.optimized.trim() || response.optimized.length > 10_000)
          throw new RangeError("优化结果长度无效。");
        const clipboardUpdated = dependencies.clipboard.readText() === source;
        if (clipboardUpdated) {
          dependencies.clipboard.writeText(response.optimized);
          undoEntry = { source, output: response.optimized, operationId };
        }
        return { source, response, operationId, clipboardUpdated };
      } finally {
        running = false;
      }
    },
    undo(operationId?: number): ClipboardUndoResult {
      if (!undoEntry || running) return { restored: false };
      if (
        (operationId !== undefined && operationId !== undoEntry.operationId) ||
        dependencies.clipboard.readText() !== undoEntry.output
      ) {
        return { restored: false, conflict: true };
      }
      const entry = undoEntry;
      dependencies.clipboard.writeText(entry.source);
      undoEntry = null;
      return {
        restored: true,
        text: entry.source,
        operationId: entry.operationId,
      };
    },
    canUndo(): boolean {
      return (
        !running &&
        undoEntry !== null &&
        dependencies.clipboard.readText() === undoEntry.output
      );
    },
  };
}
