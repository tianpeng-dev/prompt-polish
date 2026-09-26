import { BrowserWindow, safeStorage, session } from "electron";
import type { Session } from "electron";
import { readFile, unlink } from "node:fs/promises";
import {
  checkTraeBackend,
  TraeApiError,
  type BackendStatus,
} from "../src/trae-client.js";
import { readBoundedBody, withNetworkTimeout } from "../src/network.js";
import { atomicWrite, createSerialQueue } from "./storage.js";
import {
  isTraeWebsiteUrl,
  isAllowedLoginUrl,
  parseTraeWebTokenResponse,
  TRAE_WEB_LOGIN_URL,
  TRAE_WEB_TOKEN_STORAGE_KEY,
  TRAE_WEB_TOKEN_URL,
} from "../src/trae-web-session.js";

const AUTH_PARTITION = "persist:trae-web-auth";
const LOGIN_POLL_MS = 1_200;

export class TraeLoginRequiredError extends Error {
  constructor(message = "请先登录 Trae。") {
    super(message);
    this.name = "TraeLoginRequiredError";
  }
}

type TraeWebAuthOptions = {
  onLoginStarted(): void;
  onLoginFinished(authenticated: boolean): void;
  devTools: boolean;
  tokenPath: string;
  validateToken?(token: string): Promise<BackendStatus>;
};

export class TraeWebAuth {
  private readonly authSession: Session;
  private readonly validateToken: (token: string) => Promise<BackendStatus>;
  private recoveryTask: Promise<string | null> | null = null;
  private readonly storageQueue = createSerialQueue();
  private validation: {
    token: string;
    expires: number;
    task: Promise<BackendStatus>;
  } | null = null;
  private cachedToken: string | null = null;
  private storedTokenChecked = false;
  private loginTask: Promise<string> | null = null;
  private loginWindow: BrowserWindow | null = null;

  constructor(private readonly options: TraeWebAuthOptions) {
    this.authSession = session.fromPartition(AUTH_PARTITION, { cache: true });
    this.validateToken = options.validateToken ?? checkTraeBackend;
    this.authSession.setPermissionRequestHandler(
      (_contents, _permission, callback) => callback(false),
    );
    this.authSession.setPermissionCheckHandler(() => false);
  }

  get authenticated(): boolean {
    return this.cachedToken !== null;
  }

  async invalidate(): Promise<void> {
    await this.recoveryTask?.catch(() => undefined);
    this.cachedToken = null;
    this.storedTokenChecked = true;
    this.validation = null;
    await this.clearStoredToken();
  }

  async warmup(): Promise<boolean> {
    try {
      return Boolean(await this.getToken(false));
    } catch {
      return false;
    }
  }

  async getToken(interactive: boolean): Promise<string> {
    if (this.loginTask) return this.loginTask;
    if (this.cachedToken) return this.cachedToken;
    if (!this.recoveryTask) {
      this.recoveryTask = this.recoverToken().finally(() => {
        this.recoveryTask = null;
      });
    }
    const recovered = await this.recoveryTask;
    if (recovered) return recovered;
    if (!interactive) throw new TraeLoginRequiredError();
    return this.login(false);
  }

  /** Single-flight, short-lived status cache; never memoize transport failures. */
  checkToken(token: string): Promise<BackendStatus> {
    if (
      this.validation?.token === token &&
      this.validation.expires > Date.now()
    )
      return this.validation.task;
    const entry = {
      token,
      expires: Date.now() + 30_000,
      task: this.validateToken(token),
    };
    this.validation = entry;
    void entry.task.catch(() => {
      if (this.validation === entry) this.validation = null;
    });
    return entry.task;
  }

  private async recoverToken(): Promise<string | null> {
    if (!this.storedTokenChecked) {
      const storedToken = await this.readStoredToken();
      if (storedToken && (await this.checkToken(storedToken)) !== "expired") {
        this.storedTokenChecked = true;
        this.cachedToken = storedToken;
        return storedToken;
      }
      if (storedToken) await this.clearStoredToken();
      this.storedTokenChecked = true;
    }

    const sessionToken = await this.readSessionToken();
    if (sessionToken && (await this.checkToken(sessionToken)) !== "expired") {
      await this.storeToken(sessionToken);
      this.cachedToken = sessionToken;
      return sessionToken;
    }
    return null;
  }

  async login(force = false): Promise<string> {
    if (this.loginTask) return this.loginTask;
    if (!force && this.cachedToken) {
      return this.cachedToken;
    }
    this.loginTask = (async () => {
      await this.recoveryTask?.catch(() => undefined);
      if (force) {
        await this.invalidate();
        await this.authSession.clearStorageData({
          storages: ["cookies", "localstorage"],
        });
      }
      return this.runLogin();
    })();
    try {
      return await this.loginTask;
    } finally {
      this.loginTask = null;
    }
  }

  private async readSessionToken(): Promise<string | null> {
    return withNetworkTimeout(10_000, async (signal) => {
      const response = await this.authSession.fetch(TRAE_WEB_TOKEN_URL, {
        method: "POST",
        redirect: "error",
        signal,
        credentials: "include",
        headers: {
          accept: "application/json",
          "content-type": "application/json",
        },
      });
      if (response.status === 401) return null;
      if (!response.ok)
        throw new TraeApiError(
          "Trae 登录服务暂时不可用，请稍后重试。",
          "unavailable",
        );
      const body = await readBoundedBody(response, signal, 64_000);
      let data: unknown;
      try {
        data = JSON.parse(body);
      } catch {
        throw new TraeApiError("Trae 登录服务响应格式错误。", "protocol");
      }
      const token = parseTraeWebTokenResponse(data);
      if (token) return token;
      // Only a recognized missing session permits interactive login, not malformed/5xx data.
      if (
        typeof data === "object" &&
        data !== null &&
        "ResponseMetadata" in data
      ) {
        const metadata = data.ResponseMetadata as {
          Error?: { Code?: string };
        } | null;
        if (
          [
            "Unauthorized",
            "InvalidSession",
            "NotLogin",
            "InvalidToken",
          ].includes(metadata?.Error?.Code ?? "")
        )
          return null;
      }
      throw new TraeApiError(
        "Trae 登录服务未返回有效凭据，请稍后重试。",
        "protocol",
      );
    });
  }

  private async readStoredToken(): Promise<string | null> {
    if (!safeStorage.isEncryptionAvailable()) return null;
    try {
      const encrypted = Buffer.from(
        (await readFile(this.options.tokenPath, "utf8")).trim(),
        "base64",
      );
      return safeStorage.decryptString(encrypted).trim() || null;
    } catch {
      return null;
    }
  }

  private async storeToken(token: string): Promise<void> {
    if (!safeStorage.isEncryptionAvailable()) {
      throw new Error("系统无法安全保存 Trae 登录状态。");
    }
    const encrypted = safeStorage.encryptString(token).toString("base64");
    await this.storageQueue(() =>
      atomicWrite(this.options.tokenPath, `${encrypted}\n`),
    );
  }

  private async clearStoredToken(): Promise<void> {
    await this.storageQueue(() =>
      unlink(this.options.tokenPath).catch((error: NodeJS.ErrnoException) => {
        if (error.code !== "ENOENT") throw error;
      }),
    );
  }

  private async readWindowToken(window: BrowserWindow): Promise<string | null> {
    if (
      window.isDestroyed() ||
      !isTraeWebsiteUrl(window.webContents.getURL())
    ) {
      return null;
    }
    const value: unknown = await window.webContents.executeJavaScript(
      `window.localStorage.getItem(${JSON.stringify(TRAE_WEB_TOKEN_STORAGE_KEY)})`,
      true,
    );
    return typeof value === "string" && value.trim() ? value.trim() : null;
  }

  private async clearWindowToken(window: BrowserWindow): Promise<void> {
    if (
      window.isDestroyed() ||
      !isTraeWebsiteUrl(window.webContents.getURL())
    ) {
      return;
    }
    await window.webContents
      .executeJavaScript(
        `window.localStorage.removeItem(${JSON.stringify(TRAE_WEB_TOKEN_STORAGE_KEY)})`,
        true,
      )
      .catch(() => undefined);
  }

  private runLogin(): Promise<string> {
    this.options.onLoginStarted();
    const window = new BrowserWindow({
      width: 520,
      height: 720,
      minWidth: 420,
      minHeight: 560,
      show: false,
      title: "登录 Trae",
      backgroundColor: "#111827",
      autoHideMenuBar: true,
      alwaysOnTop: true,
      webPreferences: {
        session: this.authSession,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        devTools: this.options.devTools,
      },
    });
    this.loginWindow = window;

    return new Promise<string>((resolve, reject) => {
      let settled = false;
      let checking = false;
      let retryAfter = 0;
      let failures = 0;
      const cookieListener = () => void probe();
      const poll = setInterval(() => void probe(), LOGIN_POLL_MS);

      const cleanup = () => {
        clearInterval(poll);
        this.authSession.cookies.removeListener("changed", cookieListener);
        if (this.loginWindow === window) this.loginWindow = null;
      };

      const finish = async (token: string | null, error?: Error) => {
        if (settled) return;
        settled = true;
        cleanup();
        if (token) {
          try {
            await this.storeToken(token);
            this.cachedToken = token;
            await this.clearWindowToken(window);
            if (!window.isDestroyed()) window.destroy();
            this.options.onLoginFinished(true);
            resolve(token);
          } catch (storageError) {
            this.options.onLoginFinished(false);
            if (!window.isDestroyed()) window.destroy();
            reject(
              storageError instanceof Error
                ? storageError
                : new Error("无法安全保存 Trae 登录状态。"),
            );
          }
          return;
        }
        this.options.onLoginFinished(false);
        if (!window.isDestroyed()) window.destroy();
        reject(error ?? new TraeLoginRequiredError("已取消 Trae 登录。"));
      };

      const probe = async () => {
        if (
          settled ||
          checking ||
          Date.now() < retryAfter ||
          window.isDestroyed()
        )
          return;
        checking = true;
        try {
          const token =
            (await this.readWindowToken(window).catch(() => null)) ??
            (await this.readSessionToken());
          if (token && (await this.checkToken(token)) !== "expired") {
            await finish(token);
          }
          failures = 0;
        } catch {
          // Keep the login window alive on transient service failures. No unhandled promise.
          failures += 1;
          retryAfter =
            Date.now() +
            Math.min(15_000, LOGIN_POLL_MS * 2 ** Math.min(failures, 4));
        } finally {
          checking = false;
        }
      };

      this.authSession.cookies.on("changed", cookieListener);
      window.once("ready-to-show", () => window.show());
      window.on("closed", () => {
        void finish(null, new TraeLoginRequiredError("已取消 Trae 登录。"));
      });
      window.webContents.on("did-finish-load", () => void probe());
      window.webContents.on("did-navigate", () => void probe());
      window.webContents.on("did-redirect-navigation", () => void probe());
      window.webContents.on("will-navigate", (event, url) => {
        if (!isAllowedLoginUrl(url)) event.preventDefault();
      });
      window.webContents.on("will-redirect", (event, url) => {
        if (!isAllowedLoginUrl(url)) event.preventDefault();
      });
      const loadLoginUrl = (url: string) => {
        void window.loadURL(url).catch((error: unknown) => {
          // Chromium cancels superseded navigations with ERR_ABORTED; the new load may succeed.
          const code = (error as { code?: string; errno?: number })?.code;
          if (
            code === "ERR_ABORTED" ||
            (error as { errno?: number })?.errno === -3 ||
            (error instanceof Error && /ERR_ABORTED/.test(error.message))
          ) {
            void probe();
            if (!window.isDestroyed()) window.show();
            return;
          }
          void finish(
            null,
            new Error("无法打开 Trae 登录页，请检查网络后重试。"),
          );
        });
      };
      window.webContents.setWindowOpenHandler(({ url }) => {
        if (isAllowedLoginUrl(url)) loadLoginUrl(url);
        return { action: "deny" };
      });
      loadLoginUrl(TRAE_WEB_LOGIN_URL);
    });
  }
}
