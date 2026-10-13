// Trae、剪贴板与系统设置使用隔离适配器；思考方法、布局、IPC、键盘运行真实实现。
import { app, BrowserWindow, ipcMain, screen } from "electron";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { mkdirSync, mkdtempSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import assert from "node:assert/strict";
import { IPC_CHANNELS, RENDERER_EVENTS } from "../dist/desktop/types.js";
import {
  createClipboardController,
  DEFAULT_SETTINGS,
} from "../dist/desktop/logic.js";
import { assertTrustedSender } from "../dist/desktop/ipc-security.js";
import {
  THINKING_METHODS,
  generateThinkingPrompt,
} from "../dist/src/thinking-methods.js";
import {
  calculateViewBounds,
  compactAnchor,
  validateWindowView,
} from "../dist/desktop/window-layout.js";

const root = path.resolve(import.meta.dirname, "..");
mkdirSync(path.join(root, ".work"), { recursive: true });
const isolatedData = mkdtempSync(path.join(root, ".work", "electron-smoke-"));
app.setPath("userData", isolatedData);
let window;
let failure = false;
const evidence = {
  environment: {
    platform: process.platform,
    electron: process.versions.electron,
  },
  dependencyIsolation:
    "Trae, clipboard and settings adapters; not live Trae integration",
  checks: [],
  layouts: [],
};
const deadline = setTimeout(() => {
  console.error("Electron smoke exceeded 45 seconds");
  app.exit(1);
}, 45_000);
const js = (source) => window.webContents.executeJavaScript(source);
const click = (selector) =>
  js(`document.querySelector(${JSON.stringify(selector)}).click()`);
const input = (text) =>
  js(
    `document.querySelector('#editor').value=${JSON.stringify(text)};document.querySelector('#editor').dispatchEvent(new Event('input',{bubbles:true}));document.querySelector('#editor').focus();`,
  );
async function until(condition) {
  return js(
    `new Promise((resolve,reject)=>{const poll=setInterval(()=>{if(${condition}){clearInterval(poll);clearTimeout(timeout);resolve(true)}},10);const timeout=setTimeout(()=>{clearInterval(poll);reject(new Error('UI condition timed out'))},3000)})`,
  );
}
async function settle() {
  await js(
    "new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))",
  );
}
async function assertLayout(label) {
  await settle();
  if (
    await js(
      "document.querySelector('.compact-shell').dataset.view==='methods'",
    )
  ) {
    const palette = await js(`(() => {
      const menu=document.querySelector('#method-menu'), box=menu.getBoundingClientRect(), hint=document.querySelector('#method-description').getBoundingClientRect();
      return {height:innerHeight,side:document.querySelector('.compact-shell').dataset.side,editorHidden:getComputedStyle(document.querySelector('.prompt-box')).display==='none',columns:getComputedStyle(menu).gridTemplateColumns,scrollHeight:menu.scrollHeight,clientHeight:menu.clientHeight,menuBottom:box.bottom,hintTop:hint.top,options:[...menu.children].map(node=>{const r=node.getBoundingClientRect();return {id:node.dataset.method,x:r.x,y:r.y,bottom:r.bottom,right:r.right,height:r.height}})};
    })()`);
    assert(palette.editorHidden, "Editor remained visible behind the palette");
    assert.equal(palette.options.length, 12);
    if (palette.height >= 320)
      assert(
        palette.scrollHeight <= palette.clientHeight + 1,
        "Normal palette requires scrolling",
      );
    assert(
      palette.menuBottom <= palette.hintTop,
      "Menu overlaps shared method description",
    );
    for (const option of palette.options)
      assert(option.bottom <= palette.menuBottom + 1, "Method clipped");
    assert.equal(palette.options[0].y, palette.options[1].y);
    assert(palette.options[2].y > palette.options[0].y);
    assert(palette.options[1].x > palette.options[0].x);
    evidence.layouts.push({ label, ...palette });
    return;
  }
  const result = await js(`(() => {
    const rect = selector => { const r=document.querySelector(selector).getBoundingClientRect();return {x:r.x,y:r.y,right:r.right,bottom:r.bottom,width:r.width,height:r.height}; };
    const editor=rect('#editor'), footer=rect('.utility-rail'), status=rect('.status-slot'), trigger=rect('#method-trigger'), action=rect('#action-button');
    const shell=document.querySelector('.compact-shell');
    return {view:shell.dataset.view,side:shell.dataset.side,editor,footer,status,trigger,action,viewport:{width:innerWidth,height:innerHeight},fonts:{body:document.fonts.check('13px Geist'),mono:document.fonts.check('13px "JetBrains Mono"')},drag:getComputedStyle(document.querySelector('.window-drag-rail')).webkitAppRegion,noDrag:getComputedStyle(document.querySelector('#action-button')).webkitAppRegion};
  })()`);
  assert(
    result.editor.bottom <= result.footer.y + 0.5,
    "Editor overlaps footer",
  );
  assert(
    result.trigger.right <= result.status.x + 0.5,
    "Method overlaps status",
  );
  assert(
    result.status.right <= result.action.x + 0.5,
    "Status overlaps actions",
  );
  assert(result.footer.bottom <= result.viewport.height, "Footer clipped");
  assert.equal(result.drag, "drag");
  assert.equal(result.noDrag, "no-drag");
  assert(result.fonts.body && result.fonts.mono, "Bundled fonts unavailable");
  evidence.layouts.push({ label, ...result });
}
async function run() {
  try {
    await app.whenReady();
    app.dock?.hide();
    window = new BrowserWindow({
      width: 460,
      height: 176,
      frame: false,
      show: true,
      movable: true,
      resizable: false,
      alwaysOnTop: true,
      webPreferences: {
        preload: path.join(root, "dist/desktop/preload.cjs"),
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
      },
    });
    const html = path.join(root, "desktop/renderer/index.html");
    let requests = 0;
    let copied = "隔离适配器的原剪贴板";
    const clipboardController = createClipboardController({
      clipboard: {
        readText: () => copied,
        writeText: (text) => {
          copied = text;
        },
      },
      optimize: async () => {
        throw new Error("隔离适配器没有接入真实 Trae");
      },
    });
    let layout = { view: "editor", side: "below", height: 176 };
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
        window.setAlwaysOnTop(settings.alwaysOnTop);
        return snapshot();
      },
      [IPC_CHANNELS.thinkingCopy]: (_event, text, id) => {
        const response = generateThinkingPrompt(text, id);
        return {
          response,
          methodId: id,
          ...clipboardController.copy(response.optimized),
        };
      },
      [IPC_CHANNELS.clipboardCopy]: (_event, text) => {
        assert.equal(typeof text, "string");
        return clipboardController.copy(text);
      },
      [IPC_CHANNELS.clipboardUndo]: (_event, id) =>
        clipboardController.undo(id),
      [IPC_CHANNELS.windowSetView]: (_event, view) => {
        validateWindowView(view);
        const area = screen.getDisplayMatching(window.getBounds()).workArea;
        const bounds = calculateViewBounds(
          compactAnchor(window.getBounds(), layout.side),
          area,
          view,
        );
        layout = { view, side: bounds.side, height: bounds.height };
        window.setBounds({
          x: bounds.x,
          y: bounds.y,
          width: bounds.width,
          height: bounds.height,
        });
        return layout;
      },
      [IPC_CHANNELS.optimizerOptimize]: (_event, text) => {
        requests++;
        assert.equal(text, "请优化这段测试文字");
        return {
          optimized: "请清晰改写这段测试文字，保持原意。",
          metrics: {},
          traceId: "synthetic-trae-adapter",
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
    await js("document.fonts.ready");
    const isolation = await js(
      "({require:typeof window.require,process:typeof window.process,bridge:Object.keys(window.refiner),clipboard:Object.keys(window.refiner.clipboard)})",
    );
    assert.equal(isolation.require, "undefined");
    assert.equal(isolation.process, "undefined");
    assert.deepEqual(isolation.clipboard, ["copy", "optimize", "undo"]);
    evidence.checks.push({ name: "renderer sandbox", isolation });
    await assertLayout("empty");
    await input("请优化这段测试文字");
    window.webContents.sendInputEvent({ type: "keyDown", keyCode: "RETURN" });
    window.webContents.sendInputEvent({ type: "keyUp", keyCode: "RETURN" });
    await until(
      "document.querySelector('#action-button').dataset.mode==='undo'",
    );
    assert.equal(requests, 1);
    await assertLayout("ordinary-result");
    await click("#action-button");
    await until(
      "document.querySelector('#action-button').dataset.mode==='optimize'",
    );
    assert.equal(
      await js("document.querySelector('#editor').value"),
      "请优化这段测试文字",
    );
    for (const method of THINKING_METHODS) {
      const source = "解释数据库索引，保留 ${table_name} 和 /project/index.ts";
      await input(source);
      await click("#method-trigger");
      await until("!document.querySelector('#method-panel').hidden");
      await assertLayout(`palette-${method.id}`);
      await click(`[data-method="${method.id}"]`);
      await until("document.querySelector('#method-panel').hidden");
      const generated = generateThinkingPrompt(source, method.id).optimized;
      assert.equal(copied, generated);
      assert.equal(await js("document.querySelector('#editor').value"), source);
      await assertLayout(`method-${method.id}`);
      await click("#method-copy-undo");
      await until(
        "document.querySelector('#status').textContent==='已恢复之前的剪贴板内容'",
      );
      assert.equal(copied, "隔离适配器的原剪贴板");
    }
    assert.equal(requests, 1, "Local method invoked Trae");
    evidence.checks.push({
      name: "12 actual local templates, one-click copy, preserved draft and conditional undo with isolated clipboard",
      passed: true,
    });
    await input("长文本 ${placeholder}\n".repeat(90));
    const editorView = await js(
      "(() => {const editor=document.querySelector('#editor');editor.setSelectionRange(10,16);editor.scrollTop=editor.scrollHeight;return {start:editor.selectionStart,end:editor.selectionEnd,scrollTop:editor.scrollTop}})()",
    );
    await assertLayout("long-text");
    await click("#method-trigger");
    await until("!document.querySelector('#method-panel').hidden");
    await assertLayout("methods-downward");
    window.webContents.sendInputEvent({ type: "keyDown", keyCode: "END" });
    assert.equal(
      await js("document.activeElement.dataset.method"),
      "life-design",
    );
    window.webContents.sendInputEvent({ type: "keyDown", keyCode: "RETURN" });
    window.webContents.sendInputEvent({ type: "keyUp", keyCode: "RETURN" });
    await until("document.querySelector('#method-panel').hidden");
    assert.deepEqual(
      await js(
        "(() => {const editor=document.querySelector('#editor');return {start:editor.selectionStart,end:editor.selectionEnd,scrollTop:editor.scrollTop}})()",
      ),
      editorView,
      "Method copying changed the editor selection or scroll position",
    );
    assert.equal(
      copied,
      generateThinkingPrompt(
        "长文本 ${placeholder}\n".repeat(90),
        "life-design",
      ).optimized,
    );
    await click("#method-copy-view");
    await until("!document.querySelector('#detail-panel').hidden");
    assert.equal(
      await js("document.querySelector('#detail-message').textContent"),
      copied,
    );
    await click("#detail-copy");
    await until("!document.querySelector('#method-copy-actions').hidden");
    await click("#detail-close");
    await until("document.querySelector('#detail-panel').hidden");
    await click("#method-trigger");
    await until("!document.querySelector('#method-panel').hidden");
    window.webContents.sendInputEvent({ type: "keyDown", keyCode: "ESCAPE" });
    await until("document.querySelector('#method-panel').hidden");
    const area = screen.getDisplayMatching(window.getBounds()).workArea;
    window.setPosition(area.x + 80, area.y + area.height - 190);
    await click("#method-trigger");
    await until("!document.querySelector('#method-panel').hidden");
    assert.equal(layout.side, "above");
    await assertLayout("methods-upward");
    await click("#method-close");
    await until("document.querySelector('#method-panel').hidden");
    await click("#settings-button");
    await until("!document.querySelector('#settings-panel').hidden");
    assert.equal(window.getBounds().height, 280);
    const settingsGeometry = await js(
      "(() => {const rows=[...document.querySelectorAll('.setting-row')].map(node=>({top:node.getBoundingClientRect().top,bottom:node.getBoundingClientRect().bottom}));return {rows,height:innerHeight,feedback:document.querySelector('.settings-feedback').getBoundingClientRect().bottom}})()",
    );
    assert(settingsGeometry.feedback <= settingsGeometry.height);
    await click("#launch-toggle");
    await until(
      "document.querySelector('#settings-status').textContent==='设置已保存'",
    );
    assert.equal(settings.launchAtLogin, false);
    await click("#settings-close");
    await until("document.querySelector('#settings-panel').hidden");
    window.webContents.send(
      RENDERER_EVENTS.operationError,
      "外部服务连接失败，原始输入保留。".repeat(80),
    );
    await until("document.querySelector('#status').dataset.tone==='error'");
    await click("#status");
    await until("!document.querySelector('#detail-panel').hidden");
    const detailGeometry = await js(
      "(() => {const message=document.querySelector('#detail-message').getBoundingClientRect(),actions=document.querySelector('.detail-actions').getBoundingClientRect();return {messageBottom:message.bottom,actionsTop:actions.top,actionsBottom:actions.bottom,height:innerHeight}})()",
    );
    assert(detailGeometry.messageBottom < detailGeometry.actionsTop);
    assert(detailGeometry.actionsBottom <= detailGeometry.height);
    await click("#detail-close");
    await until("document.querySelector('#detail-panel').hidden");
    await click("#pin-button");
    await until(
      "document.querySelector('#pin-button').getAttribute('aria-pressed')==='false'",
    );
    assert.equal(window.isAlwaysOnTop(), false);
    await click("#pin-button");
    await until(
      "document.querySelector('#pin-button').getAttribute('aria-pressed')==='true'",
    );
    assert.equal(window.isAlwaysOnTop(), true);
    evidence.checks.push({
      name: "native view sizes, two-column palette, DOM keyboard focus, settings adapter and native pin",
      passed: true,
      settingsGeometry,
      detailGeometry,
    });
    await js("matchMedia('(prefers-reduced-motion: reduce)').matches");
    const output = path.join(root, "local-archive/stitch-2026-10-14/evidence");
    await mkdir(output, { recursive: true });
    await writeFile(
      path.join(output, "electron-smoke.json"),
      JSON.stringify({ ...evidence, passed: true }, null, 2),
    );
    console.log(
      JSON.stringify({
        passed: true,
        checks: evidence.checks,
        layoutStates: evidence.layouts.length,
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
