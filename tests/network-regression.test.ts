import { describe, expect, it, vi } from "vitest";
import {
  checkTraeBackend,
  optimizeWithTrae,
  parseTraeSse,
} from "../src/trae-client.js";
import {
  isAllowedLoginUrl,
  isTraeWebsiteUrl,
} from "../src/trae-web-session.js";

const output = 'event:output\ndata:{"response":"完整结果"}\n\n';
const done = 'event:done\ndata:{"finish_reason":"stop"}\n\n';
describe("bounded non-redirecting Trae transport", () => {
  it.each([
    output,
    output + 'event:done\ndata:{"finish_reason":"length"}\n\n',
    output + "event:output\ndata:not-json\n\n" + done,
    output + "event:output\ndata:{}\n\n" + done,
    output + done + output,
    `event:output\ndata:${JSON.stringify({ response: "x".repeat(10001) })}\n\n${done}`,
  ])(
    "rejects partial or invalid output without accepting a success",
    (body) => {
      expect(() => parseTraeSse(body)).toThrow();
    },
  );
  it("accepts the observed complete stop protocol with CRLF and heartbeat comments", () => {
    expect(
      parseTraeSse((": heartbeat\n\n" + output + done).replaceAll("\n", "\r\n"))
        .optimizedPrompt,
    ).toBe("完整结果");
  });
  it.each([401])("classifies HTTP %s as expiry", async (status) => {
    expect(
      await checkTraeBackend(
        "fake",
        vi.fn(async () => new Response("", { status })),
      ),
    ).toBe("expired");
  });
  it("distinguishes feature disabled, malformed response, and temporary failure", async () => {
    await expect(
      checkTraeBackend(
        "fake",
        vi.fn(async () => new Response("Forbidden", { status: 403 })),
      ),
    ).rejects.toMatchObject({ kind: "unavailable" });
    expect(
      await checkTraeBackend(
        "fake",
        vi.fn(async () => Response.json({ function_configs: [] })),
      ),
    ).toBe("feature-unavailable");
    await expect(
      checkTraeBackend(
        "fake",
        vi.fn(async () => Response.json({})),
      ),
    ).rejects.toMatchObject({ kind: "protocol" });
    await expect(
      checkTraeBackend(
        "fake",
        vi.fn(async () => new Response("", { status: 503 })),
      ),
    ).rejects.toMatchObject({ kind: "unavailable" });
  });
  it("covers stream failures and size limits with typed, redacted errors", async () => {
    const broken = new Response(
      new ReadableStream({
        start(controller) {
          controller.error(new Error("private-token"));
        },
      }),
    );
    await expect(
      optimizeWithTrae(
        "fake",
        "system",
        "input",
        vi.fn(async () => broken),
      ),
    ).rejects.toMatchObject({
      kind: "unavailable",
      message: "无法连接 Trae 服务，请检查网络后重试。",
    });
    await expect(
      optimizeWithTrae(
        "fake",
        "system",
        "input",
        vi.fn(async () => new Response("a".repeat(512001))),
      ),
    ).rejects.toMatchObject({ kind: "protocol" });
  });
  it("explicitly refuses redirects on both credential-bearing API calls", async () => {
    const fetcher = vi.fn(async (_url: any, init?: RequestInit) => {
      expect(init?.redirect).toBe("error");
      expect(init?.signal).toBeInstanceOf(AbortSignal);
      throw new TypeError("redirect refused");
    });
    await expect(checkTraeBackend("fake", fetcher)).rejects.toMatchObject({
      kind: "unavailable",
    });
    await expect(
      optimizeWithTrae("fake", "system", "input", fetcher),
    ).rejects.toMatchObject({ kind: "unavailable" });
  });
  it("limits navigation and token extraction to separate exact origin allowlists", () => {
    for (const url of [
      "http://www.trae.cn",
      "https://evil.trae.cn",
      "https://www.trae.cn.evil.test",
      "https://www.trae.cn:444",
      "https://user@www.trae.cn",
    ]) {
      expect(isAllowedLoginUrl(url)).toBe(false);
      expect(isTraeWebsiteUrl(url)).toBe(false);
    }
    expect(
      isAllowedLoginUrl("https://open.weixin.qq.com/connect/qrconnect"),
    ).toBe(true);
    expect(
      isTraeWebsiteUrl("https://open.weixin.qq.com/connect/qrconnect"),
    ).toBe(false);
  });
});
