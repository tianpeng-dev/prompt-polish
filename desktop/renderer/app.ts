import { formatShortcut } from "../logic.js";
import type {
  DesktopBridge,
  DesktopPlatform,
  DesktopSettings,
  SettingsSnapshot,
} from "../types.js";
import type { OptimizeResponse } from "../../src/types.js";
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

type UndoEntry = {
  kind: "editor" | "clipboard" | "draft";
  text: string;
  output?: string;
  operationId?: number;
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
};

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
  if (state.toastTimer !== null) window.clearTimeout(state.toastTimer);
  status.textContent = message;
  status.title = message;
  status.tabIndex = persistent ? 0 : -1;
  status.classList.remove("is-expanded");
  status.dataset.tone = tone;
  status.hidden = false;
  state.toastTimer = persistent
    ? null
    : window.setTimeout(() => {
        status.hidden = true;
        state.toastTimer = null;
      }, 2_800);
}

function setMode(mode: string = "optimize") {
  actionButton.dataset.mode = mode;
  const undoMode = mode === "undo";
  const undoLabel = state.undo?.kind === "draft" ? "恢复上次草稿" : "撤销优化";
  actionButton.setAttribute(
    "aria-label",
    undoMode ? undoLabel : "优化输入内容",
  );
  actionButton.title = undoMode ? undoLabel : "优化输入内容（Enter）";
  updateControls();
}

function updateControls() {
  const undoMode = actionButton.dataset.mode === "undo";
  const locked = state.busy || state.refreshing;
  actionButton.disabled =
    locked || (undoMode ? state.undo === null : !editor.value.trim());
  editor.readOnly = locked;
  document.body.classList.toggle("is-busy", state.busy);
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
  state.revision += 1;
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
) {
  stopRefreshAnimation();
  state.undo = {
    kind: undoKind,
    text: source,
    output: response.optimized,
    operationId,
  };
  setEditorValue(response.optimized);
  setMode("undo");
  showToast("优化完成", "ready");
  editor.focus();
  const end = editor.value.length;
  editor.setSelectionRange(end, end);
  editor.scrollTop = editor.scrollHeight;
}

async function optimizeEditor(clipboardSource?: string) {
  const previousDraft = editor.value;
  const source = clipboardSource ?? editor.value;
  if (!source.trim() || state.busy || state.refreshing) return;
  if (clipboardSource !== undefined) {
    state.undo = null;
    setEditorValue(source);
    setMode("optimize");
  }
  const revision = state.revision;
  state.busy = true;
  updateControls();
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
      clipboardSource !== undefined && previousDraft ? previousDraft : source,
      response,
      clipboardResult?.clipboardUpdated ? "clipboard" : "editor",
      clipboardResult?.operationId,
    );
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
    updateControls();
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
    updateControls();
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

function openSettings() {
  promptBox.inert = true;
  settingsPanel.hidden = false;
  state.settingsOpen = true;
  settingsClose.focus();
}

function closeSettings() {
  promptBox.inert = false;
  state.capturingShortcut = false;
  shortcutRecorder.classList.remove("is-recording");
  settingsPanel.hidden = true;
  state.settingsOpen = false;
  editor.focus();
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
    settingsStatus.textContent = "已取消录制。";
    return;
  }
  if (["Meta", "Alt", "Control", "Shift"].includes(event.key)) return;
  try {
    const candidate = shortcutFromEvent(event);
    const snapshot = await bridge.settings.update({ shortcut: candidate });
    renderSettings(snapshot);
    if (
      snapshot.settings.shortcut === candidate &&
      snapshot.shortcutRegistered
    ) {
      settingsStatus.textContent = `已更新为 ${formatShortcut(candidate, state.platform)}`;
      settingsStatus.dataset.tone = "ready";
      state.capturingShortcut = false;
      shortcutRecorder.classList.remove("is-recording");
    }
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
shortcutRecorder.addEventListener("click", () => {
  state.capturingShortcut = true;
  shortcutRecorder.classList.add("is-recording");
  settingsStatus.textContent = "请按下新组合键，Escape 取消。";
});
launchToggle.addEventListener("change", async () => {
  launchToggle.disabled = true;
  try {
    renderSettings(
      await bridge.settings.update({ launchAtLogin: launchToggle.checked }),
    );
  } catch (error) {
    launchToggle.checked = state.settings?.launchAtLogin ?? true;
    settingsStatus.textContent = errorMessage(error);
    settingsStatus.dataset.tone = "error";
  } finally {
    launchToggle.disabled = false;
  }
});
shortcutClipboardToggle.addEventListener("change", async () => {
  shortcutClipboardToggle.disabled = true;
  try {
    renderSettings(
      await bridge.settings.update({
        optimizeClipboardOnShortcut: shortcutClipboardToggle.checked,
      }),
    );
  } catch (error) {
    shortcutClipboardToggle.checked =
      state.settings?.optimizeClipboardOnShortcut ?? false;
    settingsStatus.textContent = errorMessage(error);
    settingsStatus.dataset.tone = "error";
  } finally {
    shortcutClipboardToggle.disabled = false;
  }
});

window.addEventListener("keydown", (event) => {
  if (state.settingsOpen && event.key === "Tab") {
    const controls = [
      ...settingsPanel.querySelectorAll<HTMLElement>(
        "button:not(:disabled), input:not(:disabled)",
      ),
    ];
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
  if (state.capturingShortcut) {
    void captureShortcut(event);
    return;
  }
  if (event.key === "Escape") {
    event.preventDefault();
    if (state.settingsOpen) closeSettings();
    else
      void bridge.window
        .hide()
        .catch((error: unknown) =>
          showToast(errorMessage(error), "error", true),
        );
    return;
  }
  if (
    event.target === editor &&
    event.key === "Enter" &&
    !event.shiftKey &&
    !event.isComposing &&
    !state.settingsOpen &&
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
    return;
  }

  updateControls();

  bridge.window.onBlankRequested(() => {
    if (state.busy) {
      showToast("正在优化，请稍候再新建草稿。", "neutral", true);
      return;
    }
    if (state.settingsOpen) closeSettings();
    if (editor.value) {
      state.undo = { kind: "draft", text: editor.value };
      setMode("undo");
    } else {
      state.undo = null;
      setMode("optimize");
    }
    setEditorValue("");
    status.hidden = true;
    editor.focus();
  });
  bridge.window.onFocusEditor(() => {
    if (state.settingsOpen) {
      settingsClose.focus();
      return;
    }
    editor.focus();
    const end = editor.value.length;
    editor.setSelectionRange(end, end);
  });
  bridge.window.onClipboardRestored((result) => {
    if (
      !result?.restored ||
      state.busy ||
      state.undo?.kind !== "clipboard" ||
      state.undo.operationId !== result.operationId ||
      editor.value !== state.undo.output
    )
      return;
    const previous = state.undo.text;
    state.undo = null;
    setEditorValue(previous);
    setMode("optimize");
    showToast("已撤销", "ready");
  });
  bridge.window.onOpenSettings(openSettings);
  bridge.window.onSettingsChanged(renderSettings);
  bridge.window.onShortcutOptimizeRequested((input) => {
    if (state.busy || state.refreshing) {
      showToast("正在处理另一项优化，请稍候。", "error", true);
      return;
    }
    if (state.settingsOpen) closeSettings();
    status.hidden = true;
    editor.focus();
    void optimizeEditor(input);
  });
  bridge.window.onAuthStatus((value) => {
    if (!value?.message) return;
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
      if (state.busy || state.revision !== initialRevision) return;
      if (!health.ok)
        showToast(health.error ?? "Trae 优化接口暂时不可用。", "error", true);
    })
    .catch((error: unknown) => {
      if (!state.busy && state.revision === initialRevision)
        showToast(errorMessage(error), "error", true);
    });
  editor.focus();
}

status.addEventListener("click", () => status.classList.toggle("is-expanded"));
status.addEventListener("keydown", (event) => {
  if (event.key === "Enter" || event.key === " ") {
    event.preventDefault();
    status.classList.toggle("is-expanded");
  }
});
void boot().catch((error: unknown) =>
  showToast(errorMessage(error), "error", true),
);
