import {
  app,
  BrowserWindow,
  clipboard,
  globalShortcut,
  ipcMain,
  Menu,
  nativeImage,
  Notification,
  screen,
  Tray,
} from "electron";
import type { MenuItemConstructorOptions } from "electron";
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { atomicWrite, createSerialQueue } from "./storage.js";
import { assertTrustedSender } from "./ipc-security.js";
import path from "node:path";
import { getTraeHealth } from "../src/trae-health.js";
import { TraeApiError } from "../src/trae-client.js";
import type { OptimizeResponse } from "../src/types.js";
import { validateInput } from "../src/validation.js";
import {
  calculateWindowPosition,
  constrainWindowPosition,
  createClipboardController,
  DEFAULT_SETTINGS,
  desktopPlatform,
  formatShortcut,
  loginItemSettings,
  normalizeSettings,
  selectDisplayForBounds,
  shouldHideWindowOnBlur,
  shouldShowWindowAtStartup,
  trayIconName,
  validateSettingsUpdate,
  validateShortcut,
} from "./logic.js";
import { TraeLoginRequiredError, TraeWebAuth } from "./trae-web-auth.js";
import {
  IPC_CHANNELS,
  RENDERER_EVENTS,
  type DesktopSettings,
  type SettingsSnapshot,
  type SettingsUpdate,
} from "./types.js";

const WINDOW_SIZE = { width: 460, height: 176 };
const SETTINGS_FILE = "settings.json";
const TRAE_TOKEN_FILE = "trae-token.enc";
const PLATFORM = desktopPlatform(process.platform);

let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let trayMenu: Menu | null = null;
let quitting = false;
let operationInProgress = false;
let settings = { ...DEFAULT_SETTINGS };
let settingsPath = "";
let registeredShortcut: string | null = null;
let shortcutError: string | null = null;
let moveSettledTimer: ReturnType<typeof setTimeout> | null = null;
let programmaticMoveTimer: ReturnType<typeof setTimeout> | null = null;
let programmaticPosition: { x: number; y: number } | null = null;
let optimizePrompt:
  ((input: unknown, token: string) => Promise<OptimizeResponse>) | null = null;
let clipboardController: ReturnType<typeof createClipboardController> | null =
  null;
let traeAuth: TraeWebAuth | null = null;
const settingsQueue = createSerialQueue();

function userMessage(error: unknown): string {
  if (
    error instanceof TraeApiError ||
    error instanceof TraeLoginRequiredError ||
    error instanceof TypeError ||
    error instanceof RangeError
  ) {
    return error.message;
  }
  if (error instanceof Error) {
    if (
      /^(?:请先登录 Trae|已取消 Trae 登录|无法打开 Trae 登录页|正在处理另一项优化)/.test(
        error.message,
      )
    ) {
      return error.message;
    }
  }
  return "操作未完成，请稍后重试。";
}

function notify(title: string, body: string): void {
  if (!Notification.isSupported()) return;
  new Notification({ title, body, silent: true }).show();
}

async function readSettings(): Promise<DesktopSettings> {
  try {
    return normalizeSettings(JSON.parse(await readFile(settingsPath, "utf8")));
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

async function saveSettings(value: DesktopSettings): Promise<void> {
  await atomicWrite(settingsPath, `${JSON.stringify(value, null, 2)}\n`);
}

function applyLoginItem(value = settings.launchAtLogin): void {
  if (!app.isPackaged || PLATFORM === "other") return;
  app.setLoginItemSettings(
    loginItemSettings(PLATFORM, value, process.execPath),
  );
}

function settingsSnapshot(): SettingsSnapshot {
  return {
    platform: PLATFORM,
    settings: { ...settings },
    shortcutRegistered: registeredShortcut === settings.shortcut,
    shortcutError,
  };
}

function sendRendererEvent(channel: string, payload?: unknown): void {
  const window = mainWindow;
  if (!window || window.isDestroyed()) return;
  const send = () => window.webContents.send(channel, payload);
  if (window.webContents.isLoading()) {
    window.webContents.once("did-finish-load", send);
  } else {
    send();
  }
}

function trayWindowPosition(): { x: number; y: number } {
  if (!tray) return { x: 24, y: 48 };
  const trayBounds = tray.getBounds();
  const display = screen.getDisplayNearestPoint({
    x: Math.round(trayBounds.x + trayBounds.width / 2),
    y: Math.round(trayBounds.y + trayBounds.height / 2),
  });
  return calculateWindowPosition(trayBounds, display.workArea, WINDOW_SIZE);
}

function constrainedPosition(bounds: {
  x: number;
  y: number;
  width: number;
  height: number;
}): { x: number; y: number } {
  const displays = screen.getAllDisplays().map((display) => ({
    id: display.id,
    workArea: display.workArea,
  }));
  const selected = selectDisplayForBounds(
    bounds,
    displays,
    screen.getPrimaryDisplay().id,
  );
  return selected
    ? constrainWindowPosition(bounds, selected.workArea)
    : { x: Math.round(bounds.x), y: Math.round(bounds.y) };
}

function resolvedWindowPosition(): { x: number; y: number } {
  if (!settings.windowPosition) return trayWindowPosition();
  return constrainedPosition({ ...settings.windowPosition, ...WINDOW_SIZE });
}

async function persistWindowPosition(position: { x: number; y: number }) {
  return settingsQueue(async () => {
    const normalized = { x: Math.round(position.x), y: Math.round(position.y) };
    if (
      settings.windowPosition?.x === normalized.x &&
      settings.windowPosition.y === normalized.y
    ) {
      return;
    }
    const next = { ...settings, windowPosition: normalized };
    try {
      await saveSettings(next);
      settings = next;
    } catch {
      sendRendererEvent(RENDERER_EVENTS.operationError, "窗口位置未保存。");
    }
  });
}

function setMainWindowPosition(position: { x: number; y: number }): void {
  const window = mainWindow;
  if (!window || window.isDestroyed()) return;
  programmaticPosition = { ...position };
  if (programmaticMoveTimer !== null) clearTimeout(programmaticMoveTimer);
  window.setPosition(position.x, position.y, false);
  programmaticMoveTimer = setTimeout(() => {
    programmaticMoveTimer = null;
    programmaticPosition = null;
  }, 250);
}

async function settleWindowPosition(): Promise<void> {
  const window = mainWindow;
  if (!window || window.isDestroyed()) return;
  const bounds = window.getBounds();
  const position = constrainedPosition(bounds);
  if (position.x !== bounds.x || position.y !== bounds.y) {
    setMainWindowPosition(position);
  }
  await persistWindowPosition(position);
}

function scheduleWindowSettle(): void {
  if (moveSettledTimer !== null) clearTimeout(moveSettledTimer);
  moveSettledTimer = setTimeout(
    () => {
      moveSettledTimer = null;
      void settleWindowPosition();
    },
    PLATFORM === "darwin" ? 120 : 0,
  );
}

function handleWindowMove(): void {
  const window = mainWindow;
  if (!window || window.isDestroyed()) return;
  const [x, y] = window.getPosition();
  if (programmaticPosition?.x === x && programmaticPosition.y === y) {
    programmaticPosition = null;
    if (programmaticMoveTimer !== null) clearTimeout(programmaticMoveTimer);
    programmaticMoveTimer = null;
    return;
  }
  programmaticPosition = null;
  if (programmaticMoveTimer !== null) clearTimeout(programmaticMoveTimer);
  programmaticMoveTimer = null;
  scheduleWindowSettle();
}

function ensureSavedWindowIsVisible(): void {
  const window = mainWindow;
  if (!window || window.isDestroyed() || !settings.windowPosition) return;
  const position = constrainedPosition({
    ...settings.windowPosition,
    ...WINDOW_SIZE,
  });
  setMainWindowPosition(position);
  void persistWindowPosition(position);
}

function showWindow(blank = false): void {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  const position = resolvedWindowPosition();
  setMainWindowPosition(position);
  if (settings.windowPosition) void persistWindowPosition(position);
  mainWindow.show();
  mainWindow.focus();
  if (blank) sendRendererEvent(RENDERER_EVENTS.blankRequested);
  sendRendererEvent(RENDERER_EVENTS.focusEditor);
}

function toggleWindow(): void {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (mainWindow.isVisible()) {
    mainWindow.hide();
  } else {
    showWindow();
  }
}

function handleGlobalShortcut(): void {
  if (!settings.optimizeClipboardOnShortcut) {
    showWindow(true);
    return;
  }

  showWindow();
  try {
    const input = clipboard.readText();
    validateInput(input);
    sendRendererEvent(RENDERER_EVENTS.shortcutOptimizeRequested, input);
  } catch (error) {
    sendRendererEvent(RENDERER_EVENTS.operationError, userMessage(error));
  }
}

function registerShortcut(shortcut: string): boolean {
  const registered = globalShortcut.register(shortcut, handleGlobalShortcut);
  if (registered) {
    registeredShortcut = shortcut;
    shortcutError = null;
  } else {
    shortcutError = `${formatShortcut(shortcut, PLATFORM)} 已被其他应用占用。`;
  }
  return registered;
}

async function updateSettings(
  update: SettingsUpdate,
): Promise<SettingsSnapshot> {
  return settingsQueue(async () => {
    const previous = settings;
    const next = { ...settings };
    if (typeof update.launchAtLogin === "boolean") {
      next.launchAtLogin = update.launchAtLogin;
    }
    if (typeof update.optimizeClipboardOnShortcut === "boolean") {
      next.optimizeClipboardOnShortcut = update.optimizeClipboardOnShortcut;
    }
    if (typeof update.alwaysOnTop === "boolean") {
      next.alwaysOnTop = update.alwaysOnTop;
    }

    let newlyRegisteredShortcut: string | null = null;
    const previousRegisteredShortcut = registeredShortcut;
    if (update.shortcut !== undefined) {
      const candidate = validateShortcut(update.shortcut);
      if (candidate !== registeredShortcut) {
        if (!globalShortcut.register(candidate, handleGlobalShortcut)) {
          shortcutError = `${formatShortcut(candidate, PLATFORM)} 已被其他应用占用，原快捷键仍然有效。`;
          return settingsSnapshot();
        }
        newlyRegisteredShortcut = candidate;
      }
      next.shortcut = candidate;
    }

    try {
      if (next.launchAtLogin !== previous.launchAtLogin)
        applyLoginItem(next.launchAtLogin);
      if (next.alwaysOnTop !== previous.alwaysOnTop)
        mainWindow?.setAlwaysOnTop(next.alwaysOnTop);
      await saveSettings(next);
    } catch (error) {
      if (next.launchAtLogin !== previous.launchAtLogin) {
        try {
          applyLoginItem(previous.launchAtLogin);
        } catch {
          /* Preserve the original failure. */
        }
      }
      if (next.alwaysOnTop !== previous.alwaysOnTop) {
        try {
          mainWindow?.setAlwaysOnTop(previous.alwaysOnTop);
        } catch {
          // A closing window must not prevent shortcut rollback below.
        }
      }
      if (newlyRegisteredShortcut) {
        globalShortcut.unregister(newlyRegisteredShortcut);
      }
      throw error;
    }
    if (newlyRegisteredShortcut) {
      if (previousRegisteredShortcut) {
        globalShortcut.unregister(previousRegisteredShortcut);
      }
      registeredShortcut = newlyRegisteredShortcut;
    }
    settings = next;
    shortcutError = null;
    rebuildTrayMenu();
    const snapshot = settingsSnapshot();
    sendRendererEvent(RENDERER_EVENTS.settingsChanged, snapshot);
    return snapshot;
  });
}

async function runExclusive<T>(operation: () => Promise<T>): Promise<T> {
  if (operationInProgress) throw new Error("正在处理另一项优化，请稍候。");
  operationInProgress = true;
  try {
    return await operation();
  } finally {
    operationInProgress = false;
  }
}

async function optimizeWithWebAuth(input: unknown): Promise<OptimizeResponse> {
  if (!optimizePrompt || !traeAuth) throw new Error("应用尚未准备完成。");
  const validated = validateInput(input);
  let token = await traeAuth.getToken(true);
  try {
    return await optimizePrompt(validated, token);
  } catch (error) {
    if (!(error instanceof TraeApiError) || error.kind !== "auth") throw error;
    await traeAuth.invalidate();
    token = await traeAuth.getToken(true);
    return optimizePrompt(validated, token);
  }
}

function loginFromTray(): void {
  if (!traeAuth) return;
  const force = traeAuth.authenticated;
  void runExclusive(() => traeAuth!.login(force))
    .then(() => notify("精炼台", "Trae 登录成功。"))
    .catch((error) => notify("Trae 登录未完成", userMessage(error)));
}

async function optimizeClipboardWithFeedback(expectedSource: string) {
  if (!clipboardController) throw new Error("应用尚未准备完成。");
  try {
    const result = await runExclusive(() =>
      clipboardController!.optimize(expectedSource),
    );
    rebuildTrayMenu();
    notify(
      "精炼台",
      result.clipboardUpdated
        ? "已优化并更新剪贴板。"
        : "优化完成；剪贴板已有新内容，未覆盖。",
    );
    return result;
  } catch (error) {
    const message = userMessage(error);
    notify("剪贴板未修改", message);
    throw new Error(message);
  }
}

function undoClipboard(operationId?: number) {
  if (!clipboardController) return { restored: false };
  const result = clipboardController.undo(operationId);
  rebuildTrayMenu();
  if (result.restored) notify("精炼台", "已恢复优化前的剪贴板内容。");
  return result;
}

function optimizeClipboardFromTray(): void {
  showWindow();
  try {
    const input = clipboard.readText();
    validateInput(input);
    sendRendererEvent(RENDERER_EVENTS.shortcutOptimizeRequested, input);
  } catch (error) {
    sendRendererEvent(RENDERER_EVENTS.operationError, userMessage(error));
  }
}

function rebuildTrayMenu(): void {
  if (!tray) return;
  const template: MenuItemConstructorOptions[] = [
    { label: "打开精炼台", click: () => showWindow() },
    { label: "优化剪贴板", click: optimizeClipboardFromTray },
    {
      label: "撤销上次剪贴板替换",
      enabled: clipboardController?.canUndo() ?? false,
      click: () => {
        const result = undoClipboard();
        if (result.restored) {
          showWindow();
          sendRendererEvent(RENDERER_EVENTS.clipboardRestored, result);
        }
      },
    },
    { type: "separator" },
    {
      label: traeAuth?.authenticated ? "重新登录 Trae…" : "登录 Trae…",
      click: loginFromTray,
    },
    { type: "separator" },
    {
      label: "登录时启动",
      type: "checkbox",
      checked: settings.launchAtLogin,
      click: (item) => {
        void updateSettings({ launchAtLogin: item.checked }).catch((error) => {
          notify("设置未保存", userMessage(error));
        });
      },
    },
    {
      label: `设置…  ${formatShortcut(settings.shortcut, PLATFORM)}`,
      click: () => {
        showWindow();
        sendRendererEvent(RENDERER_EVENTS.openSettings);
      },
    },
    { type: "separator" },
    {
      label: "退出精炼台",
      click: () => {
        quitting = true;
        app.quit();
      },
    },
  ];
  trayMenu = Menu.buildFromTemplate(template);
}

function trayImage() {
  const filename = trayIconName(PLATFORM);
  const iconPath = app.isPackaged
    ? path.join(process.resourcesPath, filename)
    : path.join(app.getAppPath(), "assets", filename);
  const image = nativeImage.createFromPath(iconPath);
  if (PLATFORM === "darwin") image.setTemplateImage(true);
  return image;
}

async function createWindow(): Promise<void> {
  const appRoot = app.getAppPath();
  mainWindow = new BrowserWindow({
    ...WINDOW_SIZE,
    show: false,
    frame: false,
    transparent: false,
    resizable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    movable: true,
    alwaysOnTop: settings.alwaysOnTop,
    skipTaskbar: true,
    hasShadow: true,
    backgroundColor: "#202125",
    webPreferences: {
      preload: path.join(appRoot, "dist", "desktop", "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      devTools: !app.isPackaged,
    },
  });

  mainWindow.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  mainWindow.webContents.on("will-navigate", (event) => event.preventDefault());
  mainWindow.on("blur", () => {
    const devToolsOpen = mainWindow?.webContents.isDevToolsOpened() ?? false;
    if (shouldHideWindowOnBlur(settings.alwaysOnTop, devToolsOpen)) {
      mainWindow?.hide();
    }
  });
  if (PLATFORM === "darwin") {
    mainWindow.on("move", handleWindowMove);
  } else {
    mainWindow.on("moved", handleWindowMove);
  }
  mainWindow.on("close", (event) => {
    if (!quitting) {
      event.preventDefault();
      mainWindow?.hide();
    }
  });
  await mainWindow.loadFile(
    path.join(appRoot, "desktop", "renderer", "index.html"),
  );
}

function createTray(): void {
  const image = trayImage();
  tray = new Tray(image);
  tray.setToolTip("精炼台");
  tray.on("click", toggleWindow);
  tray.on("right-click", () => {
    if (trayMenu) tray?.popUpContextMenu(trayMenu);
  });
  rebuildTrayMenu();
}

function setupIpc(): void {
  const expectedUrl = pathToFileURL(
    path.join(app.getAppPath(), "desktop", "renderer", "index.html"),
  ).href;
  const handle: typeof ipcMain.handle = (channel, listener) =>
    ipcMain.handle(channel, (event, ...args) => {
      assertTrustedSender(event, mainWindow?.webContents, expectedUrl);
      return listener(event, ...args);
    });
  handle(IPC_CHANNELS.optimizerHealth, () =>
    getTraeHealth(
      () => {
        if (!traeAuth) throw new TraeLoginRequiredError();
        return traeAuth.getToken(false);
      },
      (token) => traeAuth!.checkToken(token),
    ),
  );
  handle(IPC_CHANNELS.optimizerOptimize, async (_event, input: unknown) => {
    try {
      return await runExclusive(() => optimizeWithWebAuth(input));
    } catch (error) {
      throw new Error(userMessage(error));
    }
  });
  handle(IPC_CHANNELS.clipboardOptimize, (_event, input: unknown) => {
    validateInput(input);
    return optimizeClipboardWithFeedback(input as string);
  });
  handle(IPC_CHANNELS.clipboardUndo, (_event, operationId: unknown) => {
    if (
      operationId !== undefined &&
      (typeof operationId !== "number" ||
        !Number.isSafeInteger(operationId) ||
        operationId < 1)
    ) {
      throw new TypeError("撤销请求无效。");
    }
    return undoClipboard(operationId as number | undefined);
  });
  handle(IPC_CHANNELS.settingsGet, () => settingsSnapshot());
  handle(IPC_CHANNELS.settingsUpdate, (_event, value: unknown) => {
    return updateSettings(validateSettingsUpdate(value));
  });
  handle(IPC_CHANNELS.windowHide, () => mainWindow?.hide());
}

async function initialize(): Promise<void> {
  if (PLATFORM === "win32") app.setAppUserModelId("com.local.prompt-refiner");
  process.env.PROMPT_REFINER_ROOT = app.getAppPath();
  settingsPath = path.join(app.getPath("userData"), SETTINGS_FILE);
  settings = await readSettings();
  await saveSettings(settings);

  const optimizerModule = await import("../src/trae-optimizer.js");
  optimizePrompt = optimizerModule.optimizePromptWithTrae;
  traeAuth = new TraeWebAuth({
    devTools: !app.isPackaged,
    tokenPath: path.join(app.getPath("userData"), TRAE_TOKEN_FILE),
    onLoginStarted: () => {
      sendRendererEvent(RENDERER_EVENTS.authStatus, {
        message: "请在 Trae 窗口完成登录",
        tone: "neutral",
        persistent: true,
      });
    },
    onLoginFinished: (authenticated) => {
      rebuildTrayMenu();
      showWindow();
      sendRendererEvent(RENDERER_EVENTS.authStatus, {
        message: authenticated ? "登录成功，继续优化…" : "Trae 登录已取消",
        tone: authenticated ? "ready" : "error",
        persistent: !authenticated,
      });
    },
  });
  clipboardController = createClipboardController({
    clipboard,
    optimize: (input) => optimizeWithWebAuth(input),
  });

  setupIpc();
  await createWindow();
  createTray();
  screen.on("display-removed", ensureSavedWindowIsVisible);
  screen.on("display-metrics-changed", ensureSavedWindowIsVisible);
  registerShortcut(settings.shortcut);
  applyLoginItem();
  rebuildTrayMenu();
  void traeAuth.warmup().then(() => rebuildTrayMenu());

  const wasOpenedAtLogin =
    PLATFORM === "darwin" ? app.getLoginItemSettings().wasOpenedAtLogin : false;
  if (shouldShowWindowAtStartup(PLATFORM, process.argv, wasOpenedAtLogin)) {
    showWindow();
  }
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => showWindow());
  app.on("activate", () => showWindow());
  app.on("will-quit", () => globalShortcut.unregisterAll());
  app.on("window-all-closed", () => {
    // A menu-bar utility stays alive until the user chooses Quit.
  });
  app
    .whenReady()
    .then(initialize)
    .catch((error) => {
      notify("精炼台无法启动", userMessage(error));
      app.quit();
    });
}
