import { describe, expect, it, vi } from "vitest";
import {
  createTraeOptimizationInput,
  optimizeWithTrae,
  parseTraeSse,
  TRAE_TIMEOUT_MS,
} from "../src/trae-client.js";

const successSse = [
  "event:output",
  'data:{"response":"优化后的"}',
  "",
  "event:output",
  'data:{"response":"提示词"}',
  "",
  "event:token_usage",
  'data:{"total_tokens":123}',
  "",
  "event:done",
  'data:{"finish_reason":"stop"}',
  "",
].join("\n");

describe("Trae direct transport", () => {
  it("uses a bounded timeout", () => {
    expect(TRAE_TIMEOUT_MS).toBe(50_000);
  });

  it("joins output events and parses token usage", () => {
    expect(parseTraeSse(successSse)).toEqual({
      optimizedPrompt: "优化后的提示词",
      tokenUsage: 123,
    });
  });

  it("builds Trae's multimodal message request without exposing the token", async () => {
    const fetchMock = vi.fn(
      async (_url: string | URL | Request, init?: RequestInit) => {
        const body = JSON.parse(String(init?.body));
        expect(body).toMatchObject({
          function: "chat",
          usage: "input_optimization",
          model: "no_thinking_model",
        });
        expect(body.messages[0]).toEqual({
          role: "system",
          content: [{ type: "text", text: "system" }],
        });
        expect(body.messages[1]).toEqual({
          role: "user",
          content: [
            {
              type: "text",
              text: '{"user_input":"input","placeholder_map":"{}"}',
            },
          ],
        });
        const headers = new Headers(init?.headers);
        expect(headers.get("x-ide-token")).toBe("secret-token");
        expect(headers.get("x-ide-version")).toBe("3.3.88");
        expect(headers.get("x-ide-version-code")).toBe("20260212");
        expect(headers.get("x-app-version-code")).toBe("20260212");
        return new Response(successSse, {
          status: 200,
          headers: { "content-type": "text/event-stream" },
        });
      },
    );

    const result = await optimizeWithTrae(
      "secret-token",
      "system",
      "input",
      fetchMock as typeof fetch,
    );
    expect(result.optimizedPrompt).toBe("优化后的提示词");
    expect(result.tokenUsage).toBe(123);
  });

  it("passes the original text to Trae without internal protection markers", () => {
    const input = "检查 src/auth.ts 和原文 ⟦PROTECTED_000⟧";
    expect(JSON.parse(createTraeOptimizationInput(input))).toEqual({
      user_input: input,
      placeholder_map: "{}",
    });
  });

  it("maps SSE protocol errors to a safe message", () => {
    expect(() =>
      parseTraeSse(
        'event:error\ndata:{"code":4001,"message":"private upstream detail"}\n\n',
      ),
    ).toThrow("内部协议可能已变更");
  });
});
