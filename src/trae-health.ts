import { checkTraeBackend, TRAE_VERSION, TraeApiError } from "./trae-client.js";

export type TraeHealth = {
  ok: boolean;
  authenticated: boolean;
  backendAvailable: boolean;
  appVersion: string;
  error?: string;
  model: "no_thinking_model";
  transport: "direct-internal-api";
};

export async function getTraeHealth(
  getToken: () => Promise<string>,
  checkToken = checkTraeBackend,
): Promise<TraeHealth> {
  try {
    const token = await getToken();
    const status = await checkToken(token);
    const backendAvailable = status === "valid";
    return {
      ok: backendAvailable,
      authenticated: status !== "expired",
      backendAvailable,
      appVersion: TRAE_VERSION,
      model: "no_thinking_model",
      transport: "direct-internal-api",
    };
  } catch (error) {
    return {
      ok: false,
      authenticated: false,
      backendAvailable: false,
      appVersion: TRAE_VERSION,
      error:
        error instanceof TraeApiError
          ? error.message
          : "请先在精炼台中登录 Trae。",
      model: "no_thinking_model",
      transport: "direct-internal-api",
    };
  }
}
