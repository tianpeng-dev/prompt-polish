// 实际主进程、原生窗口与剪贴板验证；使用独立数据目录，结束时恢复仍属于测试的剪贴板，不修改启动项。
import { app, BrowserWindow, clipboard, screen } from "electron";
import { mkdirSync, mkdtempSync } from "node:fs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import assert from "node:assert/strict";
import { setTimeout as pause } from "node:timers/promises";
import { generateThinkingPrompt } from "../dist/src/thinking-methods.js";

const root = path.resolve(import.meta.dirname, "..");
mkdirSync(path.join(root, ".work"), { recursive: true });
const data = mkdtempSync(path.join(root, ".work", "main-smoke-"));
app.setPath("userData", data);
app.setAppPath(root);
const deadline = setTimeout(() => {
  console.error("Native main smoke exceeded 30 seconds");
  app.exit(1);
}, 30_000);
let window;
let failure = false;
let originalClipboard = null;
let ownedClipboardText = null;
const js = (source) => window.webContents.executeJavaScript(source);
async function until(condition) {
  return js(
    `new Promise((resolve,reject)=>{const poll=setInterval(()=>{if(${condition}){clearInterval(poll);clearTimeout(timeout);resolve(true)}},10);const timeout=setTimeout(()=>{clearInterval(poll);reject(new Error('UI condition timed out'))},3000)})`,
  );
}
async function run() {
  try {
    await import("../dist/desktop/main.js");
    await app.whenReady();
    app.dock?.hide();
    for (let attempt = 0; attempt < 60; attempt++) {
      window = BrowserWindow.getAllWindows()[0];
      if (
        window &&
        !window.webContents.isLoading() &&
        window.webContents.getURL().endsWith("index.html")
      )
        break;
      await pause(50);
    }
    assert(window, "Main window was not created");
    await until(
      "typeof window.refiner==='object' && document.querySelectorAll('.method-option').length===12",
    );
    assert.equal(window.getBounds().width, 460);
    assert.equal(window.getBounds().height, 176);
    const input = "本地方法验收：解释数据库索引与 ${index_name} 的关系。";
    const formats = clipboard.availableFormats();
    if (formats.length > 1)
      throw new Error(
        "当前剪贴板包含多种格式，无法逐字节批量恢复；保留现有内容，真实剪贴板验收未执行。",
      );
    originalClipboard = formats.map((format) => ({
      format,
      data: clipboard.readBuffer(format),
    }));
    ownedClipboardText = "PromptPolish 原生剪贴板测试内容";
    clipboard.writeText(ownedClipboardText);
    const generated = await js(
      `window.refiner.thinking.copy(${JSON.stringify(input)},'dual-layer')`,
    );
    ownedClipboardText = generated.response.optimized;
    assert.equal(
      generated.response.optimized,
      generateThinkingPrompt(input, "dual-layer").optimized,
    );
    assert.equal(clipboard.readText(), ownedClipboardText);
    for (const expression of [
      "window.refiner.thinking.copy({}, 'dual-layer')",
      "window.refiner.thinking.copy('x', '__proto__')",
      "window.refiner.thinking.copy('字'.repeat(10000), 'dual-layer')",
      "window.refiner.clipboard.copy('')",
      "window.refiner.window.setView({height:9999})",
    ]) {
      const error = await js(
        `${expression}.then(()=>null,error=>error.message)`,
      );
      assert.equal(typeof error, "string");
      assert.equal(clipboard.readText(), ownedClipboardText);
    }
    await js(
      `document.querySelector('#editor').value=${JSON.stringify(input)};document.querySelector('#editor').dispatchEvent(new Event('input',{bubbles:true}));document.querySelector('#editor').focus()`,
    );
    await js("document.querySelector('#method-trigger').click()");
    await until("!document.querySelector('#method-panel').hidden");
    assert.equal(
      window.getBounds().height,
      Math.min(
        320,
        screen.getDisplayMatching(window.getBounds()).workArea.height - 16,
      ),
    );
    await js("document.querySelector('[data-method=dual-layer]').click()");
    await until("document.querySelector('#method-panel').hidden");
    assert.equal(clipboard.readText(), generated.response.optimized);
    assert.equal(await js("document.querySelector('#editor').value"), input);
    await js("document.querySelector('#method-copy-view').click()");
    await until("!document.querySelector('#detail-panel').hidden");
    assert.equal(
      await js("document.querySelector('#detail-message').textContent"),
      generated.response.optimized,
    );
    ownedClipboardText = "PromptPolish 预览重新复制前的内容";
    clipboard.writeText(ownedClipboardText);
    await js("document.querySelector('#detail-copy').click()");
    for (let attempt = 0; attempt < 30; attempt++) {
      if (clipboard.readText() === generated.response.optimized) break;
      await pause(10);
    }
    ownedClipboardText = generated.response.optimized;
    assert.equal(clipboard.readText(), ownedClipboardText);
    await js("document.querySelector('#detail-close').click()");
    await until("document.querySelector('#detail-panel').hidden");
    await js("document.querySelector('#method-copy-undo').click()");
    await until(
      "document.querySelector('#status').textContent==='已恢复之前的剪贴板内容'",
    );
    ownedClipboardText = "PromptPolish 预览重新复制前的内容";
    assert.equal(clipboard.readText(), ownedClipboardText);
    assert.equal(await js("document.querySelector('#editor').value"), input);
    assert.equal(
      await js("document.querySelector('#action-label').textContent"),
      "优化",
    );
    const generic = await js("window.refiner.thinking.copy('', 'experiment')");
    ownedClipboardText = generic.response.optimized;
    assert.equal(clipboard.readText(), ownedClipboardText);
    assert.equal(generic.response.metrics.inputChars, 0);
    assert.equal(generic.response.metrics.expansionRatio, null);
    ownedClipboardText = "PromptPolish 随后复制的新内容";
    clipboard.writeText(ownedClipboardText);
    const conflict = await js(
      `window.refiner.clipboard.undo(${generic.operationId})`,
    );
    assert.equal(conflict.restored, false);
    assert.equal(conflict.conflict, true);
    assert.equal(clipboard.readText(), ownedClipboardText);
    await js("document.querySelector('#settings-button').click()");
    await until("!document.querySelector('#settings-panel').hidden");
    assert.equal(window.getBounds().height, 280);
    await js(
      "window.refiner.settings.update({alwaysOnTop:false,optimizeClipboardOnShortcut:true})",
    );
    assert.equal(window.isAlwaysOnTop(), false);
    const saved = JSON.parse(
      await readFile(path.join(data, "settings.json"), "utf8"),
    );
    assert.equal(saved.alwaysOnTop, false);
    assert.equal(saved.optimizeClipboardOnShortcut, true);
    assert.equal(saved.schemaVersion, 2);
    await js("document.querySelector('#settings-close').click()");
    await until("document.querySelector('#settings-panel').hidden");
    assert.equal(window.getBounds().height, 176);
    const area = screen.getDisplayMatching(window.getBounds()).workArea;
    window.setPosition(area.x + 1, area.y + 1);
    await pause(350);
    const moved = JSON.parse(
      await readFile(path.join(data, "settings.json"), "utf8"),
    );
    assert.deepEqual(moved.windowPosition, { x: area.x + 8, y: area.y + 8 });
    await js("window.refiner.window.hide()");
    assert.equal(window.isVisible(), false);
    app.emit("activate");
    await pause(50);
    assert.equal(window.isVisible(), true);
    await js("window.refiner.settings.update({alwaysOnTop:false})");
    await js("document.querySelector('#method-trigger').click()");
    await until("!document.querySelector('#method-panel').hidden");
    await js("document.querySelector('[data-method=socratic]').click()");
    await until("document.querySelector('#method-panel').hidden");
    ownedClipboardText = generateThinkingPrompt(input, "socratic").optimized;
    assert.equal(clipboard.readText(), ownedClipboardText);
    await pause(1000);
    assert.equal(
      window.isVisible(),
      false,
      "Unpinned method copy did not hide after confirmation",
    );
    assert.deepEqual(window.getPosition(), [area.x + 8, area.y + 8]);
    window.emit("blur");
    assert.equal(window.isVisible(), false);
    await js("window.refiner.settings.update({alwaysOnTop:true})");
    app.emit("activate");
    window.emit("blur");
    assert.equal(window.isVisible(), true);
    const result = {
      passed: true,
      platform: process.platform,
      electron: process.versions.electron,
      mainProcess: "actual desktop/main.js",
      checks: [
        "real local method copy IPC and system clipboard",
        "invalid payload rejection",
        "one-click method copy, read-only preview and conditional clipboard undo",
        "generic template and protection of a subsequent system clipboard copy",
        "unpinned automatic hiding after successful copy",
        "native settings size",
        "settings disk readback",
        "native pin levels",
        "edge snap and saved coordinates",
        "hide and show position restore",
        "blur visibility decisions",
      ],
      limitations: [
        "No live Trae login or optimization; no Windows native run; cross-application foreground switching not exercised, blur decisions verified by explicit event injection",
      ],
      settings: saved,
    };
    const output = path.join(root, "local-archive/stitch-2026-10-14/evidence");
    await mkdir(output, { recursive: true });
    await writeFile(
      path.join(output, "main-smoke.json"),
      JSON.stringify(result, null, 2),
    );
    console.log(JSON.stringify(result));
  } catch (error) {
    failure = true;
    console.error(error);
  } finally {
    clearTimeout(deadline);
    window?.destroy();
    if (originalClipboard && clipboard.readText() === ownedClipboardText) {
      clipboard.clear();
      for (const { format, data } of originalClipboard)
        clipboard.writeBuffer(format, data);
    }
    try {
      await rm(data, {
        recursive: true,
        force: true,
        maxRetries: 3,
        retryDelay: 100,
      });
    } catch (error) {
      failure = true;
      console.error(error);
    } finally {
      app.exit(failure ? 1 : 0);
    }
  }
}
void run();
