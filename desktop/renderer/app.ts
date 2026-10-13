import { formatShortcut } from "../logic.js";
import type {
  DesktopBridge,
  DesktopPlatform,
  DesktopSettings,
  SettingsSnapshot,
  ThinkingCopyResult,
} from "../types.js";
import type { OptimizeResponse } from "../../src/types.js";
import type { TraeHealth } from "../../src/trae-health.js";
import { MAX_INPUT_CHARS } from "../../src/validation.js";
import { requireThinkingMethod } from "../../src/thinking-methods.js";
import type { WindowView } from "../window-layout.js";
import { MethodMenu } from "./method-menu.js";
declare global {
  interface Window {
    refiner: DesktopBridge;
  }
}
const bridge = window.refiner;

function element<T extends HTMLElement>(selector: string): T {
  const result = document.querySelector<T>(selector);
  if (!result) throw new Error(`Missing UI element: ${selector}`);
  return result;
}

const promptBox = element(".prompt-box");
const editor = element<HTMLTextAreaElement>("#editor");
const refreshText = element("#refresh-text");
const actionButton = element<HTMLButtonElement>("#action-button");
const pinButton = element<HTMLButtonElement>("#pin-button");
const status = element("#status");
const settingsPanel = element("#settings-panel");
const settingsClose = element<HTMLButtonElement>("#settings-close");
const launchToggle = element<HTMLInputElement>("#launch-toggle");
const shortcutClipboardToggle = element<HTMLInputElement>(
  "#shortcut-clipboard-toggle",
);
const shortcutRecorder = element<HTMLButtonElement>("#shortcut-recorder");
const shortcutLabel = element("#shortcut-label");
const settingsStatus = element("#settings-status");
const shell = element(".compact-shell");
const methodTrigger = element<HTMLButtonElement>("#method-trigger");
const methodPanel = element("#method-panel");
const methodClose = element<HTMLButtonElement>("#method-close");
const methodContext = element("#method-context");
const methodCopyActions = element("#method-copy-actions");
const methodCopyView = element<HTMLButtonElement>("#method-copy-view");
const methodCopyUndo = element<HTMLButtonElement>("#method-copy-undo");
const count = element("#character-count");
const actionLabel = element("#action-label");
const actionKey = element("#action-key");
const copyButton = element<HTMLButtonElement>("#copy-button");
const settingsButton = element<HTMLButtonElement>("#settings-button");
const settingsRetry = element<HTMLButtonElement>("#settings-retry");
const shortcutHeading = element("#shortcut-heading");
const shortcutHint = element("#shortcut-hint");
const connectionButton = element<HTMLButtonElement>("#connection-button");
const connectionLabel = element("#connection-label");
const detailPanel = element("#detail-panel");
const detailTitle = element("#detail-title");
const detailMessage = element("#detail-message");
const detailHint = element(".detail-hint");
const detailClose = element<HTMLButtonElement>("#detail-close");
const detailCopy = element<HTMLButtonElement>("#detail-copy");
const detailDismiss = element<HTMLButtonElement>("#detail-dismiss");
const detailRetry = element<HTMLButtonElement>("#detail-retry");

type ResultOrigin = { source: string; output: string };
type UndoEntry = {
  kind: "editor" | "clipboard" | "draft";
  text: string;
  output?: string;
  operationId?: number;
  origin?: ResultOrigin | null;
};

const state = {
  busy: false,
  refreshing: false,
  undo: null as UndoEntry | null,
  revision: 0,
  settingsOpen: false,
  capturingShortcut: false,
  platform: "darwin" as DesktopPlatform,
  settings: null as DesktopSettings | null,
  toastTimer: null as number | null,
  methodOpen: false,
  methodCopy: null as ThinkingCopyResult | null,
  autoHideTimer: null as number | null,
  detailOpen: false,
  viewSequence: 0,
  lastResult: null as ResultOrigin | null,
  pendingSettings: null as
    Parameters<DesktopBridge["settings"]["update"]>[0] | null,
  savingSettings: false,
  health: null as TraeHealth | null,
  authBusy: false,
  lastRetry: null as (() => Promise<void>) | null,
};

const methodMenu = new MethodMenu(
  element("#method-menu"),
  element("#method-description"),
  (id) => void copyWithMethod(id),
);

function cancelAutoHide() {
  if (state.autoHideTimer !== null) window.clearTimeout(state.autoHideTimer);
  state.autoHideTimer = null;
}

function scheduleAutoHide() {
  cancelAutoHide();
  if (state.settings?.alwaysOnTop !== false) return;
  state.autoHideTimer = window.setTimeout(() => {
    state.autoHideTimer = null;
    if (state.settings?.alwaysOnTop || shell.dataset.view !== "editor") return;
    void bridge.window.hide().catch(handleViewError);
  }, 800);
}

function handleViewError(error: unknown) {
  showToast(errorMessage(error), "error", true);
}

async function changeView(view: WindowView): Promise<boolean> {
  cancelAutoHide();
  const sequence = ++state.viewSequence;
  const layout = await bridge.window.setView(view);
  if (sequence !== state.viewSequence) return false;
  shell.dataset.view = layout.view;
  shell.dataset.side = layout.side;
  return true;
}

async function closePanels() {
  if (!(await changeView("editor"))) return;
  state.settingsOpen = state.methodOpen = state.detailOpen = false;
  state.capturingShortcut = false;
  settingsPanel.hidden = methodPanel.hidden = detailPanel.hidden = true;
  shortcutRecorder.classList.remove("is-recording");
  shortcutHeading.textContent = "全局快捷键";
  shortcutHint.textContent = "点击后按下新组合键";
  status.classList.remove("is-expanded");
  methodTrigger.setAttribute("aria-expanded", "false");
  promptBox.inert = false;
  editor.focus();
}

async function openMethodMenu() {
  if (state.busy) return;
  if (state.methodOpen) {
    await closePanels();
    methodTrigger.focus();
    return;
  }
  if (!(await changeView("methods"))) return;
  state.methodOpen = true;
  promptBox.inert = true;
  state.settingsOpen = state.detailOpen = false;
  settingsPanel.hidden = detailPanel.hidden = true;
  methodPanel.hidden = false;
  const source = editor.value.trim();
  methodContext.textContent = source
    ? `用于：${source.replace(/\s+/g, " ")}`
    : "当前没有正文，将复制通用方法提示词";
  methodContext.title = source
    ? "使用当前编辑器正文"
    : "复制后，AI 会先询问你希望讨论的问题或材料";
  methodTrigger.setAttribute("aria-expanded", "true");
  methodMenu.focusFirst();
}

async function openDetails(preview = false) {
  const copied = preview ? state.methodCopy : null;
  if (preview && !copied) return;
  if (!status.textContent || !(await changeView("details"))) return;
  detailTitle.textContent = copied ? "提示词预览" : "操作详情";
  detailMessage.textContent = copied?.response.optimized ?? status.textContent;
  detailMessage.dataset.tone = copied
    ? "neutral"
    : (status.dataset.tone ?? "neutral");
  detailCopy.textContent = copied ? "复制提示词" : "复制详情";
  detailDismiss.textContent = copied ? "返回编辑" : "保留草稿";
  detailHint.textContent = copied
    ? `${requireThinkingMethod(copied.methodId).name} · 已复制，编辑器正文保持不变。`
    : state.busy
      ? "正在处理，请稍候。"
      : state.lastRetry
        ? "输入内容已保留，可重新执行当前操作。"
        : "关闭详情后可继续编辑。";
  detailRetry.hidden =
    Boolean(copied) || state.lastRetry === null || state.busy;
  state.detailOpen = true;
  state.settingsOpen = state.methodOpen = false;
  settingsPanel.hidden = methodPanel.hidden = true;
  methodTrigger.setAttribute("aria-expanded", "false");
  status.classList.add("is-expanded");
  promptBox.inert = true;
  detailPanel.hidden = false;
  detailClose.focus();
}

function errorMessage(error: unknown) {
  const raw =
    typeof error === "object" &&
    error !== null &&
    "message" in error &&
    typeof error.message === "string"
      ? error.message
      : String(error ?? "操作失败。");
  return raw.replace(/^Error invoking remote method '[^']+': (?:Error: )?/, "");
}

function showToast(message: string, tone = "neutral", persistent = false) {
  methodCopyActions.hidden = true;
  if (state.toastTimer !== null) window.clearTimeout(state.toastTimer);
  status.textContent = message;
  status.title = message;
  status.tabIndex = persistent ? 0 : -1;
  status.classList.remove("is-expanded");
  status.dataset.tone = tone;
  status.hidden = false;
  count.hidden = true;
  state.toastTimer = persistent
    ? null
    : window.setTimeout(() => {
        status.hidden = true;
        count.hidden = false;
        state.toastTimer = null;
        methodCopyActions.hidden = true;
      }, 2_800);
}

function setMode(mode: string = "optimize") {
  actionButton.dataset.mode = mode;
  const undoMode = mode === "undo";
  const undoLabel = state.undo?.kind === "draft" ? "恢复上次草稿" : "撤销优化";
  const operationLabel = "优化输入内容";
  actionButton.setAttribute(
    "aria-label",
    undoMode ? undoLabel : operationLabel,
  );
  actionButton.title = undoMode ? undoLabel : `${operationLabel}（Enter）`;
  actionLabel.textContent = undoMode
    ? state.undo?.kind === "draft"
      ? "恢复"
      : "撤销"
    : state.busy
      ? "处理中"
      : "优化";
  actionKey.textContent = undoMode
    ? state.platform === "darwin"
      ? "⌘Z"
      : "Ctrl+Z"
    : "Enter";
  updateControls();
}

function updateControls() {
  const undoMode = actionButton.dataset.mode === "undo";
  const locked = state.busy || state.refreshing;
  actionButton.disabled =
    locked ||
    (undoMode
      ? state.undo === null
      : !editor.value.trim() || processingInput().length > MAX_INPUT_CHARS);
  editor.readOnly = locked;
  methodTrigger.disabled = locked;
  methodMenu.setBusy(locked);
  methodCopyUndo.disabled = locked;
  methodCopyView.disabled = locked;
  copyButton.hidden = !editor.value.trim();
  copyButton.disabled = locked || editor.value.length > 10_000;
  const generated = state.lastResult?.output === editor.value;
  count.textContent = generated
    ? `${editor.value.length} 字符`
    : `${editor.value.length} / ${MAX_INPUT_CHARS}`;
  count.dataset.invalid = String(
    !generated && editor.value.length > MAX_INPUT_CHARS,
  );
  count.hidden = !status.hidden;
  document.body.classList.toggle("is-busy", state.busy);
}

function processingInput(): string {
  return state.lastResult?.output === editor.value
    ? state.lastResult.source
    : editor.value;
}

function syncRefreshScroll() {
  refreshText.style.transform = `translateY(-${editor.scrollTop}px)`;
}

function stopRefreshAnimation() {
  state.refreshing = false;
  promptBox.classList.remove("is-refreshing");
  refreshText.textContent = "";
  refreshText.style.transform = "";
  updateControls();
}

function startRefreshAnimation(value: string) {
  stopRefreshAnimation();
  refreshText.textContent = value;
  syncRefreshScroll();
  void refreshText.offsetWidth;
  state.refreshing = true;
  promptBox.classList.add("is-refreshing");
  updateControls();
}

function handleEditorInput() {
  cancelAutoHide();
  state.revision += 1;
  state.lastResult = null;
  state.lastRetry = null;
  if (state.toastTimer !== null) window.clearTimeout(state.toastTimer);
  state.toastTimer = null;
  status.hidden = true;
  methodCopyActions.hidden = true;
  if (state.refreshing) stopRefreshAnimation();
  if (actionButton.dataset.mode === "undo") {
    state.undo = null;
    setMode("optimize");
    return;
  }
  updateControls();
}

function setEditorValue(value: string) {
  state.revision += 1;
  if (state.refreshing) stopRefreshAnimation();
  editor.value = value;
  updateControls();
}

function applyOptimization(
  source: string,
  response: OptimizeResponse,
  undoKind: UndoEntry["kind"],
  operationId?: number,
  processingSource = source,
  previousOrigin: ResultOrigin | null = null,
) {
  stopRefreshAnimation();
  state.undo = {
    kind: undoKind,
    text: source,
    output: response.optimized,
    operationId,
    origin: previousOrigin,
  };
  state.lastResult = { source: processingSource, output: response.optimized };
  setEditorValue(response.optimized);
  setMode("undo");
  showToast("优化完成", "ready");
  if (!state.settingsOpen && !state.methodOpen && !state.detailOpen)
    editor.focus();
  const end = editor.value.length;
  editor.setSelectionRange(end, end);
  editor.scrollTop = editor.scrollHeight;
}

async function optimizeEditor(clipboardSource?: string) {
  const previousDraft = editor.value;
  const previousOrigin = state.lastResult;
  const source = clipboardSource ?? processingInput();
  if (!source.trim() || state.busy || state.refreshing) return;
  if (source.length > MAX_INPUT_CHARS) {
    showToast("输入内容不能超过 2000 个字符。", "error", true);
    return;
  }
  if (clipboardSource !== undefined) {
    state.lastResult = null;
    state.undo = null;
    setEditorValue(source);
    setMode("optimize");
  }
  const revision = state.revision;
  state.busy = true;
  setMode("optimize");
  state.lastRetry = () => optimizeEditor(clipboardSource);
  showToast("正在优化…", "neutral", true);
  startRefreshAnimation(source);
  try {
    const clipboardResult =
      clipboardSource !== undefined
        ? await bridge.clipboard.optimize(clipboardSource)
        : null;
    const response =
      clipboardResult?.response ?? (await bridge.optimizer.optimize(source));
    if (revision !== state.revision) {
      showToast("编辑内容已变化，未替换当前草稿。", "neutral", true);
      return;
    }
    applyOptimization(
      previousDraft || source,
      response,
      clipboardResult?.clipboardUpdated ? "clipboard" : "editor",
      clipboardResult?.operationId,
      source,
      previousOrigin,
    );
    state.lastRetry = null;
    if (clipboardResult) {
      showToast(
        clipboardResult.clipboardUpdated
          ? "优化完成，已更新剪贴板"
          : "优化完成；剪贴板已有新内容，未覆盖",
        "ready",
        !clipboardResult.clipboardUpdated,
      );
    }
  } catch (error) {
    showToast(errorMessage(error), "error", true);
  } finally {
    stopRefreshAnimation();
    state.busy = false;
    setMode(actionButton.dataset.mode);
  }
}

async function undoOptimization() {
  if (!state.undo || state.busy) return;
  const previous = state.undo;
  const revision = state.revision;
  state.busy = true;
  updateControls();
  try {
    const result =
      previous.kind === "clipboard"
        ? await bridge.clipboard.undo(previous.operationId)
        : null;
    if (revision !== state.revision) return;
    state.undo = null;
    state.lastResult = previous.origin ?? null;
    setEditorValue(previous.text);
    setMode("optimize");
    showToast(
      result?.conflict ? "已恢复编辑内容；剪贴板已有新内容，未修改" : "已撤销",
      "ready",
    );
    editor.focus();
  } catch (error) {
    showToast(errorMessage(error), "error", true);
  } finally {
    state.busy = false;
    setMode(actionButton.dataset.mode);
  }
}

function renderPinState(alwaysOnTop: boolean) {
  pinButton.setAttribute("aria-pressed", String(alwaysOnTop));
  const label = alwaysOnTop ? "取消窗口置顶" : "窗口置顶";
  pinButton.setAttribute("aria-label", label);
  pinButton.title = label;
  promptBox.classList.toggle("is-pinned", alwaysOnTop);
}

function renderSettings(snapshot: SettingsSnapshot) {
  state.platform = snapshot.platform;
  state.settings = snapshot.settings;
  launchToggle.checked = snapshot.settings.launchAtLogin;
  shortcutClipboardToggle.checked =
    snapshot.settings.optimizeClipboardOnShortcut;
  shortcutLabel.textContent = formatShortcut(
    snapshot.settings.shortcut,
    state.platform,
  );
  shortcutRecorder.classList.toggle(
    "shortcut-recorder--error",
    !snapshot.shortcutRegistered,
  );
  settingsStatus.textContent = snapshot.shortcutError ?? "";
  settingsStatus.dataset.tone = snapshot.shortcutError ? "error" : "neutral";
  renderPinState(snapshot.settings.alwaysOnTop);
  setMode(actionButton.dataset.mode);
}

async function saveSetting(
  update: Parameters<DesktopBridge["settings"]["update"]>[0],
) {
  if (state.savingSettings) return;
  state.savingSettings = true;
  launchToggle.disabled =
    shortcutClipboardToggle.disabled =
    shortcutRecorder.disabled =
    settingsRetry.disabled =
      true;
  settingsRetry.hidden = true;
  try {
    const snapshot = await bridge.settings.update(update);
    renderSettings(snapshot);
    state.pendingSettings = null;
    if (!snapshot.shortcutError) {
      settingsStatus.textContent = update.shortcut
        ? `已更新为 ${formatShortcut(snapshot.settings.shortcut, state.platform)}`
        : "设置已保存";
      settingsStatus.dataset.tone = "ready";
      state.capturingShortcut = false;
      shortcutRecorder.classList.remove("is-recording");
      shortcutHeading.textContent = "全局快捷键";
      shortcutHint.textContent = "点击后按下新组合键";
    }
  } catch (error) {
    state.pendingSettings = update;
    launchToggle.checked = state.settings?.launchAtLogin ?? true;
    shortcutClipboardToggle.checked =
      state.settings?.optimizeClipboardOnShortcut ?? false;
    settingsStatus.textContent = errorMessage(error);
    settingsStatus.dataset.tone = "error";
    settingsRetry.hidden = false;
  } finally {
    state.savingSettings = false;
    launchToggle.disabled =
      shortcutClipboardToggle.disabled =
      shortcutRecorder.disabled =
      settingsRetry.disabled =
        false;
  }
}

function renderHealth(health: TraeHealth) {
  state.health = health;
  connectionButton.dataset.state = health.ok ? "ready" : "error";
  connectionLabel.textContent = health.authenticated ? "Trae" : "登录";
  connectionButton.title = health.ok
    ? "Trae CN 已连接，点击检查连接"
    : (health.error ??
      (health.authenticated
        ? "Trae CN 服务暂时不可用"
        : "登录 Trae CN 以使用普通优化"));
  connectionButton.setAttribute("aria-label", connectionButton.title);
}

async function connectTrae() {
  if (state.authBusy || state.busy) return;
  state.authBusy = true;
  connectionButton.disabled = true;
  connectionButton.dataset.state = "loading";
  try {
    const health = state.health?.ok
      ? await bridge.optimizer.health()
      : await bridge.auth.login();
    renderHealth(health);
    if (!health.ok)
      throw new Error(health.error ?? "Trae CN 服务暂时不可用，请稍后重试。");
    showToast("Trae 已连接", "ready");
    state.lastRetry = null;
  } catch (error) {
    connectionButton.dataset.state = "error";
    showToast(errorMessage(error), "error", true);
    state.lastRetry = connectTrae;
  } finally {
    state.authBusy = false;
    connectionButton.disabled = false;
  }
}

async function copyContent(text: string = editor.value) {
  if (!text.trim()) return;
  try {
    const result = await bridge.clipboard.copy(text);
    if (state.methodCopy?.response.optimized === text) {
      state.methodCopy = {
        ...state.methodCopy,
        operationId: result.operationId,
      };
      showMethodCopyFeedback();
    } else showToast("已复制", "ready");
  } catch (error) {
    showToast(errorMessage(error), "error", true);
  }
}

function showMethodCopyFeedback() {
  const result = state.methodCopy;
  if (!result) throw new Error("没有可展示的思考方法复制结果。");
  const method = requireThinkingMethod(result.methodId);
  showToast(`已复制 · ${method.name}`, "ready", true);
  methodCopyActions.hidden = false;
  methodCopyView.title = `查看已复制的${method.name}提示词`;
}

async function copyWithMethod(methodId: string) {
  if (state.busy || state.refreshing) return;
  cancelAutoHide();
  state.busy = true;
  updateControls();
  methodMenu.message("正在复制提示词…");
  let copied = false;
  try {
    const result = await bridge.thinking.copy(editor.value, methodId);
    state.methodCopy = result;
    copied = true;
    state.lastRetry = null;
    await closePanels();
    showMethodCopyFeedback();
    scheduleAutoHide();
  } catch (error) {
    const message = errorMessage(error);
    methodMenu.message(message, "error");
    showToast(message, "error", true);
    if (!copied) state.lastRetry = () => copyWithMethod(methodId);
  } finally {
    state.busy = false;
    updateControls();
  }
}

async function undoMethodCopy() {
  if (!state.methodCopy || state.busy) return;
  cancelAutoHide();
  state.busy = true;
  updateControls();
  try {
    const result = await bridge.clipboard.undo(state.methodCopy.operationId);
    state.methodCopy = null;
    showToast(
      result.restored
        ? "已恢复之前的剪贴板内容"
        : result.conflict
          ? "剪贴板已有新内容，未修改"
          : "没有可撤销的剪贴板替换",
      result.restored ? "ready" : "neutral",
    );
  } catch (error) {
    showToast(errorMessage(error), "error", true);
  } finally {
    state.busy = false;
    updateControls();
  }
}

async function toggleAlwaysOnTop() {
  if (!state.settings || pinButton.disabled) return;
  const previous = state.settings.alwaysOnTop;
  pinButton.disabled = true;
  try {
    const snapshot = await bridge.settings.update({ alwaysOnTop: !previous });
    renderSettings(snapshot);
    showToast(snapshot.settings.alwaysOnTop ? "已置顶" : "已取消置顶", "ready");
  } catch (error) {
    renderPinState(previous);
    showToast(errorMessage(error), "error", true);
  } finally {
    pinButton.disabled = false;
  }
}

async function openSettings() {
  if (!(await changeView("settings"))) return;
  state.methodOpen = state.detailOpen = false;
  methodPanel.hidden = detailPanel.hidden = true;
  methodTrigger.setAttribute("aria-expanded", "false");
  promptBox.inert = true;
  settingsPanel.hidden = false;
  state.settingsOpen = true;
  settingsClose.focus();
}

function closeSettings() {
  void closePanels().catch(handleViewError);
}

function shortcutFromEvent(event: KeyboardEvent) {
  const primaryPressed =
    state.platform === "darwin" ? event.metaKey : event.ctrlKey;
  const additionalPressed =
    state.platform === "darwin"
      ? event.altKey || event.ctrlKey || event.shiftKey
      : event.altKey || event.shiftKey;
  if (!primaryPressed || !additionalPressed) {
    throw new Error(
      state.platform === "darwin"
        ? "请使用 Command，并搭配 Option、Control 或 Shift。"
        : "请使用 Ctrl，并搭配 Alt 或 Shift。",
    );
  }
  let key = "";
  if (/^Key[A-Z]$/.test(event.code)) key = event.code.slice(3);
  if (/^Digit[0-9]$/.test(event.code)) key = event.code.slice(5);
  if (/^F(?:[1-9]|1\d|20)$/.test(event.code)) key = event.code;
  if (!key) throw new Error("请再按一个字母、数字或功能键。");
  return [
    "CommandOrControl",
    state.platform === "darwin" && event.ctrlKey ? "Control" : null,
    event.altKey ? "Alt" : null,
    event.shiftKey ? "Shift" : null,
    key,
  ]
    .filter(Boolean)
    .join("+");
}

async function captureShortcut(event: KeyboardEvent) {
  event.preventDefault();
  event.stopPropagation();
  if (event.key === "Escape") {
    state.capturingShortcut = false;
    shortcutRecorder.classList.remove("is-recording");
    shortcutHeading.textContent = "全局快捷键";
    shortcutHint.textContent = "点击后按下新组合键";
    settingsStatus.textContent = "已取消录制。";
    return;
  }
  if (["Meta", "Alt", "Control", "Shift"].includes(event.key)) {
    settingsStatus.textContent = "请同时按下修饰键与字母、数字或功能键。";
    settingsStatus.dataset.tone = "neutral";
    return;
  }
  try {
    const candidate = shortcutFromEvent(event);
    await saveSetting({ shortcut: candidate });
  } catch (error) {
    settingsStatus.textContent = errorMessage(error);
    settingsStatus.dataset.tone = "error";
  }
}

editor.addEventListener("input", handleEditorInput);
editor.addEventListener("scroll", syncRefreshScroll);
actionButton.addEventListener("click", () => {
  if (actionButton.dataset.mode === "undo") void undoOptimization();
  else void optimizeEditor();
});
pinButton.addEventListener("click", () => void toggleAlwaysOnTop());
settingsClose.addEventListener("click", closeSettings);
settingsButton.addEventListener(
  "click",
  () => void openSettings().catch(handleViewError),
);
methodTrigger.addEventListener(
  "click",
  () => void openMethodMenu().catch(handleViewError),
);
methodClose.addEventListener(
  "click",
  () =>
    void closePanels()
      .then(() => methodTrigger.focus())
      .catch(handleViewError),
);
copyButton.addEventListener("click", () => void copyContent());
methodCopyView.addEventListener(
  "click",
  () => void openDetails(true).catch(handleViewError),
);
methodCopyUndo.addEventListener("click", () => void undoMethodCopy());
connectionButton.addEventListener("click", () => void connectTrae());
settingsRetry.addEventListener("click", () => {
  if (state.pendingSettings) void saveSetting(state.pendingSettings);
});
detailClose.addEventListener(
  "click",
  () => void closePanels().catch(handleViewError),
);
detailDismiss.addEventListener(
  "click",
  () => void closePanels().catch(handleViewError),
);
detailCopy.addEventListener(
  "click",
  () => void copyContent(detailMessage.textContent ?? ""),
);
detailRetry.addEventListener("click", () => {
  const retry = state.lastRetry;
  void closePanels()
    .then(() => retry?.())
    .catch(handleViewError);
});
shortcutRecorder.addEventListener("click", () => {
  state.capturingShortcut = true;
  shortcutRecorder.classList.add("is-recording");
  settingsStatus.textContent = "请按下新组合键，Escape 取消。";
  settingsStatus.dataset.tone = "neutral";
  shortcutHeading.textContent = "正在录制快捷键…";
  shortcutHint.textContent = "请按下新组合键，Escape 取消。";
});
launchToggle.addEventListener(
  "change",
  () => void saveSetting({ launchAtLogin: launchToggle.checked }),
);
shortcutClipboardToggle.addEventListener(
  "change",
  () =>
    void saveSetting({
      optimizeClipboardOnShortcut: shortcutClipboardToggle.checked,
    }),
);

window.addEventListener("keydown", (event) => {
  cancelAutoHide();
  if (state.capturingShortcut) {
    if (!state.savingSettings) void captureShortcut(event);
    else event.preventDefault();
    return;
  }
  if (
    (state.settingsOpen || state.detailOpen || state.methodOpen) &&
    event.key === "Tab"
  ) {
    const panel = state.settingsOpen
      ? settingsPanel
      : state.methodOpen
        ? methodPanel
        : detailPanel;
    const controls = [
      ...panel.querySelectorAll<HTMLElement>(
        "button:not(:disabled):not([tabindex='-1']), input:not(:disabled)",
      ),
    ].filter((control) => !control.closest("[hidden]"));
    const first = controls[0];
    const last = controls.at(-1);
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last?.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first?.focus();
    }
    return;
  }
  if (event.key === "Escape") {
    event.preventDefault();
    if (state.settingsOpen || state.methodOpen || state.detailOpen)
      void closePanels().catch(handleViewError);
    else
      void bridge.window
        .hide()
        .catch((error: unknown) =>
          showToast(errorMessage(error), "error", true),
        );
    return;
  }
  if (
    !state.settingsOpen &&
    !state.methodOpen &&
    !state.detailOpen &&
    actionButton.dataset.mode === "undo" &&
    ((state.platform === "darwin" && event.metaKey) ||
      (state.platform !== "darwin" && event.ctrlKey)) &&
    event.key.toLowerCase() === "z" &&
    !event.shiftKey &&
    !event.isComposing
  ) {
    event.preventDefault();
    void undoOptimization();
    return;
  }
  if (
    event.target === editor &&
    event.key === "Enter" &&
    !event.shiftKey &&
    !event.isComposing &&
    event.keyCode !== 229 &&
    !state.settingsOpen &&
    !state.methodOpen &&
    !state.detailOpen &&
    actionButton.dataset.mode === "optimize"
  ) {
    event.preventDefault();
    void optimizeEditor();
  }
});

async function boot() {
  if (!bridge) {
    showToast("请从精炼台桌面应用打开。", "error", true);
    actionButton.disabled = true;
    editor.disabled = true;
    for (const button of document.querySelectorAll<HTMLButtonElement>("button"))
      button.disabled = true;
    return;
  }

  updateControls();

  bridge.window.onLayoutChanged((layout) => {
    shell.dataset.side = layout.side;
  });
  bridge.window.onBlankRequested(() => {
    if (state.busy) {
      showToast("正在优化，请稍候再新建草稿。", "neutral", true);
      return;
    }
    if (state.settingsOpen || state.methodOpen || state.detailOpen)
      void closePanels().catch(handleViewError);
    if (editor.value) {
      state.undo = {
        kind: "draft",
        text: editor.value,
        origin: state.lastResult,
      };
      setMode("undo");
    } else {
      state.undo = null;
      setMode("optimize");
    }
    setEditorValue("");
    state.lastResult = null;
    state.lastRetry = null;
    status.hidden = true;
    editor.focus();
  });
  bridge.window.onFocusEditor(() => {
    cancelAutoHide();
    if (state.settingsOpen) {
      settingsClose.focus();
      return;
    }
    if (state.methodOpen) {
      methodMenu.focusFirst();
      return;
    }
    if (state.detailOpen) {
      detailClose.focus();
      return;
    }
    editor.focus();
    const end = editor.value.length;
    editor.setSelectionRange(end, end);
  });
  bridge.window.onClipboardRestored((result) => {
    if (
      result?.restored &&
      state.methodCopy?.operationId === result.operationId
    ) {
      state.methodCopy = null;
      showToast("已恢复之前的剪贴板内容", "ready");
    }
    if (
      !result?.restored ||
      state.busy ||
      state.undo?.kind !== "clipboard" ||
      state.undo.operationId !== result.operationId ||
      editor.value !== state.undo.output
    )
      return;
    const previous = state.undo.text;
    const previousOrigin = state.undo.origin;
    state.undo = null;
    state.lastResult = previousOrigin ?? null;
    setEditorValue(previous);
    setMode("optimize");
    showToast("已撤销", "ready");
  });
  bridge.window.onOpenSettings(
    () => void openSettings().catch(handleViewError),
  );
  bridge.window.onSettingsChanged(renderSettings);
  bridge.window.onShortcutOptimizeRequested((input) => {
    if (state.busy || state.refreshing) {
      showToast("正在处理另一项优化，请稍候。", "error", true);
      return;
    }
    if (state.settingsOpen || state.methodOpen || state.detailOpen)
      void closePanels().catch(handleViewError);
    status.hidden = true;
    editor.focus();
    void optimizeEditor(input);
  });
  bridge.window.onAuthStatus((value) => {
    if (!value?.message) return;
    connectionButton.dataset.state =
      value.tone === "ready"
        ? "ready"
        : value.tone === "error"
          ? "error"
          : "loading";
    if (value.tone === "ready") connectionLabel.textContent = "Trae";
    if (state.methodOpen && !state.authBusy) return;
    showToast(
      value.message,
      value.tone ?? "neutral",
      value.persistent ?? false,
    );
  });
  bridge.window.onOperationError((message) =>
    showToast(message, "error", true),
  );
  try {
    renderSettings(await bridge.settings.get());
  } catch (error) {
    showToast(errorMessage(error), "error", true);
  }
  const initialRevision = state.revision;
  void bridge.optimizer
    .health()
    .then((health) => {
      renderHealth(health);
      if (state.busy || state.revision !== initialRevision || state.methodCopy)
        return;
      if (!health.ok && !state.methodOpen)
        showToast(health.error ?? "Trae 优化接口暂时不可用。", "error", true);
    })
    .catch((error: unknown) => {
      connectionButton.dataset.state = "error";
      connectionButton.title = errorMessage(error);
      if (
        !state.busy &&
        !state.methodCopy &&
        state.revision === initialRevision &&
        !state.methodOpen
      )
        showToast(errorMessage(error), "error", true);
    });
  editor.focus();
}

status.addEventListener(
  "click",
  () => void openDetails(!methodCopyActions.hidden).catch(handleViewError),
);
window.addEventListener("pointerdown", cancelAutoHide);
void boot().catch((error: unknown) =>
  showToast(errorMessage(error), "error", true),
);
