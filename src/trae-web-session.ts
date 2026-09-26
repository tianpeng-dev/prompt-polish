export const TRAE_WEB_LOGIN_URL = "https://www.trae.cn/login";
export const TRAE_WEB_TOKEN_URL =
  "https://api.trae.cn/cloudide/api/v3/common/GetUserToken";
export const TRAE_WEB_TOKEN_STORAGE_KEY = "Cloud-IDE-Token";

export function parseTraeWebTokenResponse(value: unknown): string | null {
  if (
    typeof value !== "object" ||
    value === null ||
    !("Result" in value) ||
    typeof value.Result !== "object" ||
    value.Result === null ||
    !("Token" in value.Result) ||
    typeof value.Result.Token !== "string"
  ) {
    return null;
  }
  const token = value.Result.Token.trim();
  return token || null;
}

export function isTraeWebsiteUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return (
      url.protocol === "https:" &&
      !url.username &&
      !url.password &&
      !url.port &&
      [
        "trae.cn",
        "www.trae.cn",
        "api.trae.cn",
        "trae.com.cn",
        "www.trae.com.cn",
        "api.trae.com.cn",
      ].includes(url.hostname)
    );
  } catch {
    return false;
  }
}

/** Navigation only, not token access. Do not trust arbitrary subdomains or HTTPS sites. */
export function isAllowedLoginUrl(value: string): boolean {
  if (isTraeWebsiteUrl(value)) return true;
  try {
    const url = new URL(value);
    return (
      url.protocol === "https:" &&
      !url.username &&
      !url.password &&
      !url.port &&
      [
        "open.weixin.qq.com",
        "passport.feishu.cn",
        "accounts.feishu.cn",
      ].includes(url.hostname)
    );
  } catch {
    return false;
  }
}
