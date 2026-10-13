import type { OptimizeResponse } from "../src/types.js";
import type { TraeHealth } from "../src/trae-health.js";
import type { WindowLayout, WindowView } from "./window-layout.js";

export const IPC_CHANNELS = {
  optimizerHealth: "optimizer:health",
  optimizerOptimize: "optimizer:optimize",
  thinkingCopy: "thinking:copy",
  authLogin: "auth:login",
  clipboardCopy: "clipboard:copy",
  clipboardOptimize: "clipboard:optimize",
  clipboardUndo: "clipboard:undo",
  settingsGet: "settings:get",
  settingsUpdate: "settings:update",
  windowHide: "window:hide",
  windowSetView: "window:set-view",
} as const;

export const RENDERER_EVENTS = {
  blankRequested: "window:blank-requested",
  focusEditor: "window:focus-editor",
  clipboardRestored: "clipboard:restored",
  openSettings: "settings:open",
  settingsChanged: "settings:changed",
  shortcutOptimizeRequested: "shortcut:optimize-requested",
  authStatus: "auth:status",
  operationError: "operation:error",
  layoutChanged: "window:layout-changed",
} as const;

export type WindowPosition = {
  x: number;
  y: number;
};

export type DesktopSettings = {
  schemaVersion: 2;
  launchAtLogin: boolean;
  optimizeClipboardOnShortcut: boolean;
  shortcut: string;
  alwaysOnTop: boolean;
  windowPosition: WindowPosition | null;
};

export type DesktopPlatform = "darwin" | "win32" | "other";

export type SettingsUpdate = {
  launchAtLogin?: boolean;
  optimizeClipboardOnShortcut?: boolean;
  shortcut?: string;
  alwaysOnTop?: boolean;
};

export type SettingsSnapshot = {
  platform: DesktopPlatform;
  settings: DesktopSettings;
  shortcutRegistered: boolean;
  shortcutError: string | null;
};

export type ClipboardOptimizeResult = {
  source: string;
  response: OptimizeResponse;
  operationId: number;
  clipboardUpdated: boolean;
};

export type ClipboardUndoResult = {
  restored: boolean;
  text?: string;
  operationId?: number;
  conflict?: boolean;
};

export type ThinkingCopyResult = {
  methodId: string;
  response: OptimizeResponse;
  operationId: number;
};

export type ClipboardCopyResult = { operationId: number };

export type DesktopBridge = {
  optimizer: {
    health(): Promise<TraeHealth>;
    optimize(input: string): Promise<OptimizeResponse>;
  };
  thinking: {
    copy(input: string, methodId: string): Promise<ThinkingCopyResult>;
  };
  auth: {
    login(): Promise<TraeHealth>;
  };
  clipboard: {
    copy(text: string): Promise<ClipboardCopyResult>;
    optimize(expectedSource: string): Promise<ClipboardOptimizeResult>;
    undo(operationId?: number): Promise<ClipboardUndoResult>;
  };
  settings: {
    get(): Promise<SettingsSnapshot>;
    update(input: SettingsUpdate): Promise<SettingsSnapshot>;
  };
  window: {
    hide(): Promise<void>;
    setView(view: WindowView): Promise<WindowLayout>;
    onLayoutChanged(callback: (layout: WindowLayout) => void): () => void;
    onBlankRequested(callback: () => void): () => void;
    onFocusEditor(callback: () => void): () => void;
    onClipboardRestored(
      callback: (result: ClipboardUndoResult) => void,
    ): () => void;
    onOpenSettings(callback: () => void): () => void;
    onSettingsChanged(
      callback: (snapshot: SettingsSnapshot) => void,
    ): () => void;
    onShortcutOptimizeRequested(callback: (input: string) => void): () => void;
    onAuthStatus(
      callback: (value: {
        message: string;
        tone?: string;
        persistent?: boolean;
      }) => void,
    ): () => void;
    onOperationError(callback: (message: string) => void): () => void;
  };
};
