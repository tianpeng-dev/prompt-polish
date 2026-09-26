import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { TraeApiError, type BackendStatus } from "../src/trae-client.js";

const fake = vi.hoisted(() => ({
  windows: [] as any[],
  session: null as any,
  load: vi.fn(),
  windowToken: null as string | null,
}));
vi.mock("electron", async () => {
  const { EventEmitter } = await import("node:events");
  fake.session = {
    fetch: vi.fn(),
    cookies: new EventEmitter(),
    clearStorageData: vi.fn(async () => {}),
    setPermissionRequestHandler: vi.fn(),
    setPermissionCheckHandler: vi.fn(),
  };
  class Window extends EventEmitter {
    dead = false;
    webContents: any = new EventEmitter();
    constructor() {
      super();
      this.webContents.getURL = () => "https://www.trae.cn/login";
      this.webContents.executeJavaScript = vi.fn(async (script: string) =>
        script.includes("getItem") ? fake.windowToken : null,
      );
      this.webContents.setWindowOpenHandler = vi.fn();
      fake.windows.push(this);
    }
    loadURL(url: string) {
      return fake.load(url);
    }
    isDestroyed() {
      return this.dead;
    }
    destroy() {
      this.dead = true;
      this.emit("closed");
    }
    show() {}
  }
  return {
    BrowserWindow: Window,
    session: { fromPartition: () => fake.session },
    safeStorage: {
      isEncryptionAvailable: () => true,
      encryptString: (s: string) => Buffer.from(s),
      decryptString: (b: Buffer) => b.toString(),
    },
  };
});
import { TraeWebAuth } from "../desktop/trae-web-auth.js";

let directory: string;
let tokenPath: string;
const tick = () => new Promise<void>((resolve) => setImmediate(resolve));
function auth(validate = vi.fn(async (): Promise<BackendStatus> => "valid")) {
  return new TraeWebAuth({
    tokenPath,
    devTools: false,
    validateToken: validate,
    onLoginStarted() {},
    onLoginFinished() {},
  });
}
async function saveToken(token: string) {
  await writeFile(tokenPath, Buffer.from(token).toString("base64"));
}
beforeEach(async () => {
  vi.clearAllMocks();
  fake.windows.length = 0;
  fake.windowToken = null;
  fake.load.mockResolvedValue(undefined);
  fake.session.fetch.mockResolvedValue(new Response("", { status: 401 }));
  directory = await mkdtemp(path.join(tmpdir(), "refiner-auth-test-"));
  tokenPath = path.join(directory, "token.enc");
});
afterEach(async () => {
  for (const window of fake.windows) if (!window.dead) window.destroy();
  vi.useRealTimers();
  await rm(directory, { recursive: true, force: true });
});

describe("authentication recovery", () => {
  it("keeps saved credentials and avoids login on a transient failure; next attempt retries", async () => {
    await saveToken("synthetic");
    const validate = vi
      .fn<() => Promise<BackendStatus>>()
      .mockRejectedValueOnce(new TraeApiError("离线", "unavailable"))
      .mockResolvedValue("valid");
    const a = auth(validate);
    await expect(a.getToken(true)).rejects.toMatchObject({
      kind: "unavailable",
    });
    expect(await readFile(tokenPath, "utf8")).toBe(
      Buffer.from("synthetic").toString("base64"),
    );
    expect(fake.windows).toHaveLength(0);
    expect(await a.getToken(true)).toBe("synthetic");
    expect(validate).toHaveBeenCalledTimes(2);
  });

  it("does not treat feature-disabled status as expired", async () => {
    await saveToken("synthetic");
    const a = auth(vi.fn(async () => "feature-unavailable" as const));
    expect(await a.getToken(true)).toBe("synthetic");
    expect(fake.windows).toHaveLength(0);
  });

  it("deduplicates startup recovery and health validation, and persists refreshed session tokens", async () => {
    fake.session.fetch.mockImplementation(async () => {
      await tick();
      return Response.json({ Result: { Token: "fresh-synthetic" } });
    });
    const validate = vi.fn(async () => "valid" as const);
    const a = auth(validate);
    const tokens = await Promise.all([
      a.getToken(false),
      a.getToken(true),
      a.warmup(),
    ]);
    expect(tokens).toEqual(["fresh-synthetic", "fresh-synthetic", true]);
    await a.checkToken("fresh-synthetic");
    expect(fake.session.fetch).toHaveBeenCalledTimes(1);
    expect(validate).toHaveBeenCalledTimes(1);
    expect(
      Buffer.from(
        (await readFile(tokenPath, "utf8")).trim(),
        "base64",
      ).toString(),
    ).toBe("fresh-synthetic");
    expect(fake.session.fetch.mock.calls[0][1]).toMatchObject({
      redirect: "error",
      signal: expect.any(AbortSignal),
    });
  });

  it("replaces confirmed expired stored token through the session without interactive login", async () => {
    await saveToken("expired");
    fake.session.fetch.mockResolvedValue(
      Response.json({ Result: { Token: "fresh" } }),
    );
    const a = auth(
      vi.fn(async (token?: string) =>
        token === "expired" ? "expired" : "valid",
      ),
    );
    expect(await a.getToken(true)).toBe("fresh");
    await a.invalidate();
    await expect(readFile(tokenPath)).rejects.toMatchObject({ code: "ENOENT" });
    expect(a.authenticated).toBe(false);
    expect(fake.windows).toHaveLength(0);
  });

  it.each(["fetch", "body"])(
    "bounds a stalled session %s and allows a later request",
    async (stage) => {
      const a = auth();
      vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
      fake.session.fetch.mockImplementationOnce(() =>
        stage === "fetch"
          ? new Promise(() => {})
          : Promise.resolve(new Response(new ReadableStream({ start() {} }))),
      );
      const request = a.getToken(true);
      const assertion = expect(request).rejects.toMatchObject({
        kind: "unavailable",
      });
      await vi.waitFor(() =>
        expect(fake.session.fetch).toHaveBeenCalledTimes(1),
      );
      await vi.advanceTimersByTimeAsync(10_001);
      await assertion;
      expect(fake.windows).toHaveLength(0);
      vi.useRealTimers();
      fake.session.fetch.mockResolvedValue(
        Response.json({ Result: { Token: "recovered" } }),
      );
      expect(await a.getToken(false)).toBe("recovered");
    },
  );

  it.each([503, 200])(
    "does not open login on invalid session response status %s",
    async (status) => {
      fake.session.fetch.mockResolvedValue(new Response("broken", { status }));
      await expect(auth().getToken(true)).rejects.toBeInstanceOf(TraeApiError);
      expect(fake.windows).toHaveLength(0);
    },
  );

  it("keeps aborted navigation recoverable, denies unsafe navigation and cleans up polling", async () => {
    fake.load.mockRejectedValueOnce(
      Object.assign(new Error("ERR_ABORTED"), { errno: -3 }),
    );
    const a = auth();
    const login = a.login();
    await tick();
    expect(fake.windows).toHaveLength(1);
    const window = fake.windows[0];
    expect(window.dead).toBe(false);
    const event = { preventDefault: vi.fn() };
    window.webContents.emit(
      "will-navigate",
      event,
      "https://attacker.example/",
    );
    window.webContents.emit("will-redirect", event, "file:///private");
    expect(event.preventDefault).toHaveBeenCalledTimes(2);
    const open = window.webContents.setWindowOpenHandler.mock.calls[0][0];
    open({ url: "https://evil.example/" });
    expect(fake.load).toHaveBeenCalledTimes(1);
    fake.windowToken = "recovered-after-navigation";
    window.webContents.emit("did-finish-load");
    expect(await login).toBe("recovered-after-navigation");
    expect(window.dead).toBe(true);
    expect(fake.session.cookies.listenerCount("changed")).toBe(0);
  });

  it("deduplicates forced logins and catches popup load errors", async () => {
    const a = auth();
    const first = a.login(true).catch((e: Error) => e.message);
    const second = a.login(true).catch((e: Error) => e.message);
    await vi.waitFor(() => expect(fake.windows).toHaveLength(1));
    fake.load.mockRejectedValue(new Error("network detail with private URL"));
    fake.windows[0].webContents.setWindowOpenHandler.mock.calls[0][0]({
      url: "https://www.trae.cn/login",
    });
    expect(await first).toBe("无法打开 Trae 登录页，请检查网络后重试。");
    expect(await second).toBe(await first);
    expect(fake.session.cookies.listenerCount("changed")).toBe(0);
  });

  it("denies remote session permissions", () => {
    auth();
    const callback = vi.fn();
    fake.session.setPermissionRequestHandler.mock.calls.at(-1)[0](
      null,
      "media",
      callback,
    );
    expect(callback).toHaveBeenCalledWith(false);
    expect(fake.session.setPermissionCheckHandler.mock.calls.at(-1)[0]()).toBe(
      false,
    );
  });
});
