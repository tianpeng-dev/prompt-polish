// Isolated integration smoke: no real tokens, system clipboard, startup items or user settings.
import { app, BrowserWindow, ipcMain } from "electron";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import assert from "node:assert/strict";
import { IPC_CHANNELS } from "../dist/desktop/types.js";
import { DEFAULT_SETTINGS } from "../dist/desktop/logic.js";
import { assertTrustedSender } from "../dist/desktop/ipc-security.js";

const root = path.resolve(import.meta.dirname, "..");
const isolatedData = mkdtempSync(
  path.join(tmpdir(), "refiner-electron-smoke-"),
);
app.setPath("userData", isolatedData);
const deadline = setTimeout(() => {
  console.error("Electron smoke exceeded 20 seconds");
  app.exit(1);
}, 20_000);
let window;
let failure = false;
async function run() {
  try {
    await app.whenReady();
    app.dock?.hide();
    window = new BrowserWindow({
      width: 460,
      height: 176,
      frame: false,
      show: true,
      webPreferences: {
        preload: path.join(root, "dist/desktop/preload.cjs"),
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
      },
    });
    const html = path.join(root, "desktop/renderer/index.html");
    let requests = 0;
    const settings = { ...DEFAULT_SETTINGS };
    const snapshot = () => ({
      platform: process.platform === "win32" ? "win32" : "darwin",
      settings,
      shortcutRegistered: true,
      shortcutError: null,
    });
    const handlers = {
      [IPC_CHANNELS.optimizerHealth]: () => ({ ok: true, authenticated: true }),
      [IPC_CHANNELS.settingsGet]: snapshot,
      [IPC_CHANNELS.settingsUpdate]: (_event, update) => {
        Object.assign(settings, update);
        return snapshot();
      },
      [IPC_CHANNELS.optimizerOptimize]: (_event, input) => {
        requests += 1;
        assert.equal(input, "请优化这段测试文字");
        return {
          optimized: "请清晰改写这段测试文字，保持原意。",
          metrics: {},
          traceId: "synthetic-smoke",
        };
      },
      [IPC_CHANNELS.windowHide]: () => {},
    };
    for (const [channel, handler] of Object.entries(handlers))
      ipcMain.handle(channel, (event, ...args) => {
        assertTrustedSender(
          event,
          window.webContents,
          pathToFileURL(html).href,
        );
        return handler(event, ...args);
      });
    await window.loadFile(html);
    const isolation = await window.webContents.executeJavaScript(`({
    require: typeof window.require, process: typeof window.process,
    bridge: Object.keys(window.refiner), clipboard: Object.keys(window.refiner.clipboard)
  })`);
    assert.equal(isolation.require, "undefined");
    assert.equal(isolation.process, "undefined");
    assert.deepEqual(isolation.clipboard, ["optimize", "undo"]);
    await window.webContents.executeJavaScript(`
    document.querySelector('#editor').value = '请优化这段测试文字';
    document.querySelector('#editor').dispatchEvent(new Event('input', {bubbles: true}));
    document.querySelector('#editor').focus();
  `);
    window.webContents.sendInputEvent({ type: "keyDown", keyCode: "RETURN" });
    window.webContents.sendInputEvent({ type: "keyUp", keyCode: "RETURN" });
    const result = await window.webContents
      .executeJavaScript(`new Promise((resolve, reject) => {
    const timeout = setTimeout(() => { clearInterval(poll); reject(new Error('optimization did not complete')); }, 3000);
    const poll = setInterval(() => {
      if (document.querySelector('#action-button').dataset.mode === 'undo') {
        clearInterval(poll); clearTimeout(timeout); resolve(document.querySelector('#editor').value);
      }
    }, 20);
  })`);
    assert.equal(requests, 1);
    assert.equal(result, "请清晰改写这段测试文字，保持原意。");
    await window.webContents.executeJavaScript(
      "new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))",
    );
    const output = path.join(root, "output/playwright");
    await mkdir(output, { recursive: true });
    await writeFile(
      path.join(output, "electron-sandbox-smoke.png"),
      (await window.webContents.capturePage()).toPNG(),
    );
    await window.webContents.executeJavaScript(
      "document.querySelector('#action-button').click()",
    );
    assert.equal(
      await window.webContents.executeJavaScript(
        "document.querySelector('#editor').value",
      ),
      "请优化这段测试文字",
    );
    console.log(
      JSON.stringify({
        passed: true,
        isolation,
        optimizeRequests: requests,
        enterAndUndo: true,
      }),
    );
  } catch (error) {
    failure = true;
    console.error(error);
  } finally {
    clearTimeout(deadline);
    window?.destroy();
    await rm(isolatedData, { recursive: true, force: true });
    app.exit(failure ? 1 : 0);
  }
}
void run();
