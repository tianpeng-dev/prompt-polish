import { contextBridge, ipcRenderer } from "electron";
import {
  IPC_CHANNELS as channels,
  RENDERER_EVENTS as events,
  type DesktopBridge,
} from "./types.js";

function subscribe<T>(
  channel: string,
  callback: (value: T) => void,
): () => void {
  const listener = (_event: Electron.IpcRendererEvent, value: T) =>
    callback(value);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
}

const bridge: DesktopBridge = {
  optimizer: {
    health: () => ipcRenderer.invoke(channels.optimizerHealth),
    optimize: (input) => ipcRenderer.invoke(channels.optimizerOptimize, input),
  },
  clipboard: {
    optimize: (expectedSource) =>
      ipcRenderer.invoke(channels.clipboardOptimize, expectedSource),
    undo: (operationId) =>
      ipcRenderer.invoke(channels.clipboardUndo, operationId),
  },
  settings: {
    get: () => ipcRenderer.invoke(channels.settingsGet),
    update: (input) => ipcRenderer.invoke(channels.settingsUpdate, input),
  },
  window: {
    hide: () => ipcRenderer.invoke(channels.windowHide),
    onBlankRequested: (callback) => subscribe(events.blankRequested, callback),
    onFocusEditor: (callback) => subscribe(events.focusEditor, callback),
    onClipboardRestored: (callback) =>
      subscribe(events.clipboardRestored, callback),
    onOpenSettings: (callback) => subscribe(events.openSettings, callback),
    onSettingsChanged: (callback) =>
      subscribe(events.settingsChanged, callback),
    onShortcutOptimizeRequested: (callback) =>
      subscribe(events.shortcutOptimizeRequested, callback),
    onAuthStatus: (callback) => subscribe(events.authStatus, callback),
    onOperationError: (callback) => subscribe(events.operationError, callback),
  },
};
contextBridge.exposeInMainWorld("refiner", bridge);
