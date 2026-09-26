import { afterEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import * as disk from "node:fs/promises";
import path from "node:path";
import vm from "node:vm";
import { tmpdir } from "node:os";
import { createRequire } from "node:module";
import ts from "typescript";
import { assertTrustedSender } from "../desktop/ipc-security.js";

const require = createRequire(import.meta.url);
const directories: string[] = [];
afterEach(async () => {
  for (const directory of directories.splice(0))
    await disk.rm(directory, { recursive: true, force: true });
});

/** Runs the actual main-process functions without initializing Electron or touching user data. */
async function mainHarness() {
  const directory = await disk.mkdtemp(
    path.join(tmpdir(), "refiner-main-test-"),
  );
  directories.push(directory);
  const filename = path.join(directory, "settings.json");
  const loginItem = vi.fn();
  const setAlwaysOnTop = vi.fn();
  const register = vi.fn(() => true);
  const unregister = vi.fn();
  const handlers = new Map<string, (...args: any[]) => any>();
  const mainFrame = { url: "" };
  const contents = {
    mainFrame,
    isDestroyed: () => false,
    isLoading: () => false,
    send: vi.fn(),
  };
  let failWrite = false;
  const fakeFs = {
    ...disk,
    writeFile: async (...args: Parameters<typeof disk.writeFile>) => {
      if (failWrite) throw new Error("synthetic disk failure");
      await new Promise((r) => setTimeout(r, 2));
      return disk.writeFile(...args);
    },
  };
  const electron = {
    app: {
      requestSingleInstanceLock: () => false,
      quit() {},
      isPackaged: true,
      getAppPath: () => process.cwd(),
      setLoginItemSettings: loginItem,
    },
    globalShortcut: { register, unregister },
    ipcMain: {
      handle: (name: string, handler: (...args: any[]) => any) =>
        handlers.set(name, handler),
    },
  };
  const cache = new Map<string, { exports: any }>();
  const load = (relative: string): any => {
    const file = path.resolve(relative);
    if (cache.has(file)) return cache.get(file)!.exports;
    const module = { exports: {} as any };
    cache.set(file, module);
    let source = fs.readFileSync(file, "utf8");
    if (file === path.resolve("desktop", "main.ts"))
      source += `\nObject.assign(exports, { updateSettings, settingsSnapshot, persistWindowPosition, setupIpc, configure(p, w) {settingsPath=p; mainWindow=w;} });`;
    const code = ts.transpileModule(source, {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2023,
        esModuleInterop: true,
      },
    }).outputText;
    vm.runInNewContext(
      code,
      {
        exports: module.exports,
        module,
        require: (name: string) =>
          name === "electron"
            ? electron
            : name === "node:fs/promises"
              ? fakeFs
              : name.startsWith(".")
                ? load(
                    path.resolve(
                      path.dirname(file),
                      name.replace(/\.js$/, ".ts"),
                    ),
                  )
                : require(name),
        process,
        Buffer,
        URL,
        Response,
        TextDecoder,
        AbortController,
        AbortSignal,
        performance,
        fetch,
        setTimeout,
        clearTimeout,
        setInterval,
        clearInterval,
        console,
      },
      { filename: file },
    );
    return module.exports;
  };
  const main = load("desktop/main.ts");
  main.configure(filename, {
    isDestroyed: () => false,
    setAlwaysOnTop,
    webContents: contents,
  });
  return {
    main,
    filename,
    loginItem,
    setAlwaysOnTop,
    register,
    unregister,
    contents,
    handlers,
    fail: () => {
      failWrite = true;
    },
    recover: () => {
      failWrite = false;
    },
  };
}

describe("main-process settings transactions", () => {
  it("merges simultaneous pin, startup, shortcut and position updates without lost writes", async () => {
    const h = await mainHarness();
    await Promise.all([
      h.main.updateSettings({ alwaysOnTop: false }),
      h.main.persistWindowPosition({ x: -101.6, y: 90.4 }),
      h.main.updateSettings({ launchAtLogin: false }),
      h.main.updateSettings({
        optimizeClipboardOnShortcut: true,
        shortcut: "CommandOrControl+Alt+O",
      }),
    ]);
    const persisted = JSON.parse(await disk.readFile(h.filename, "utf8"));
    expect(persisted).toMatchObject({
      alwaysOnTop: false,
      launchAtLogin: false,
      optimizeClipboardOnShortcut: true,
      shortcut: "CommandOrControl+Alt+O",
      windowPosition: { x: -102, y: 90 },
    });
    expect(h.main.settingsSnapshot().settings).toEqual(persisted);
    expect(await disk.readdir(path.dirname(h.filename))).toEqual([
      "settings.json",
    ]);
    expect(h.loginItem).toHaveBeenCalledTimes(1);
  });

  it("rolls back native state and shortcut registration on write failure and recovers the queue", async () => {
    const h = await mainHarness();
    await h.main.updateSettings({ shortcut: "CommandOrControl+Alt+O" });
    const previous = h.main.settingsSnapshot().settings;
    h.fail();
    await expect(
      h.main.updateSettings({
        alwaysOnTop: false,
        shortcut: "CommandOrControl+Alt+N",
      }),
    ).rejects.toThrow();
    expect(h.main.settingsSnapshot().settings).toEqual(previous);
    expect(h.setAlwaysOnTop.mock.calls.map((call) => call[0])).toEqual([
      false,
      true,
    ]);
    expect(h.unregister).toHaveBeenCalledWith("CommandOrControl+Alt+N");
    expect(h.unregister).not.toHaveBeenCalledWith("CommandOrControl+Alt+O");
    h.recover();
    await h.main.updateSettings({ alwaysOnTop: false });
    expect(h.main.settingsSnapshot().settings.alwaysOnTop).toBe(false);
    expect(await disk.readdir(path.dirname(h.filename))).toEqual([
      "settings.json",
    ]);
  });

  it("unregisters the candidate shortcut even if the native window is already destroyed", async () => {
    const h = await mainHarness();
    h.setAlwaysOnTop.mockImplementation(() => {
      throw new Error("window destroyed");
    });
    await expect(
      h.main.updateSettings({
        alwaysOnTop: false,
        shortcut: "CommandOrControl+Alt+N",
      }),
    ).rejects.toThrow();
    expect(h.unregister).toHaveBeenCalledWith("CommandOrControl+Alt+N");
    expect(h.main.settingsSnapshot().settings.alwaysOnTop).toBe(true);
  });

  it("keeps the old shortcut on registration conflict", async () => {
    const h = await mainHarness();
    h.register.mockReturnValue(false);
    const result = await h.main.updateSettings({
      shortcut: "CommandOrControl+Alt+N",
    });
    expect(result.settings.shortcut).toBe("CommandOrControl+Alt+P");
    expect(result.shortcutError).toContain("原快捷键仍然有效");
    expect(h.unregister).not.toHaveBeenCalled();
  });

  it("guards every registered IPC endpoint, including read-only requests", async () => {
    const h = await mainHarness();
    h.main.setupIpc();
    expect(h.handlers.size).toBe(7);
    for (const handler of h.handlers.values())
      expect(() =>
        handler({ sender: {}, senderFrame: null }, "synthetic"),
      ).toThrow("拒绝未经授权");
    expect(h.handlers.has("clipboard:write")).toBe(false);
  });
});

describe("IPC origin boundary", () => {
  it("accepts only the exact UI file in the main window top frame", () => {
    const frame = { url: "file:///app/desktop/renderer/index.html" };
    const contents = { mainFrame: frame, isDestroyed: () => false } as any;
    expect(() =>
      assertTrustedSender(
        { sender: contents, senderFrame: frame } as any,
        contents,
        frame.url,
      ),
    ).not.toThrow();
    for (const senderFrame of [
      null,
      { url: frame.url },
      { url: "https://www.trae.cn" },
    ]) {
      expect(() =>
        assertTrustedSender(
          { sender: contents, senderFrame } as any,
          contents,
          frame.url,
        ),
      ).toThrow();
    }
    expect(() =>
      assertTrustedSender(
        { sender: contents, senderFrame: frame } as any,
        contents,
        "file:///other.html",
      ),
    ).toThrow();
  });
});
