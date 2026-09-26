import { TraeApiError } from "./errors.js";

/** Bound the entire exchange, including a server that never completes its body. */
export async function withNetworkTimeout<T>(
  timeoutMs: number,
  operation: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout>;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(
        new TraeApiError("Trae 请求超时，请检查网络后重试。", "unavailable"),
      );
    }, timeoutMs);
  });
  try {
    return await Promise.race([operation(controller.signal), deadline]);
  } catch (error) {
    if (error instanceof TraeApiError) throw error;
    throw new TraeApiError(
      "无法连接 Trae 服务，请检查网络后重试。",
      "unavailable",
    );
  } finally {
    clearTimeout(timer!);
    controller.abort();
  }
}

export async function readBoundedBody(
  response: Response,
  signal: AbortSignal,
  limit = 512_000,
): Promise<string> {
  if (Number(response.headers.get("content-length")) > limit) {
    void response.body?.cancel().catch(() => undefined);
    throw new TraeApiError("Trae 响应过大，未采用该结果。", "protocol");
  }
  if (!response.body) return "";
  const reader = response.body.getReader();
  const abort = () => {
    void reader.cancel().catch(() => undefined);
  };
  signal.addEventListener("abort", abort, { once: true });
  const decoder = new TextDecoder();
  let bytes = 0;
  let result = "";
  try {
    while (true) {
      signal.throwIfAborted();
      const { done, value } = await reader.read();
      signal.throwIfAborted();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > limit)
        throw new TraeApiError("Trae 响应过大，未采用该结果。", "protocol");
      result += decoder.decode(value, { stream: true });
    }
    return result + decoder.decode();
  } finally {
    signal.removeEventListener("abort", abort);
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}
