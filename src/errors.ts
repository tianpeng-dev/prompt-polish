/** Safe user-facing failures; never carry raw upstream bodies, URLs or credentials. */
export class TraeApiError extends Error {
  constructor(
    message: string,
    readonly kind: "auth" | "credits" | "protocol" | "unavailable",
    readonly statusCode = 502,
  ) {
    super(message);
    this.name = "TraeApiError";
  }
}
