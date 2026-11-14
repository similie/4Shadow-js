/** An error response from the API (or a network failure, with status 0). */
export class ForeshadowError extends Error {
  readonly status: number;
  /** The API's `detail` message, when it sent one. */
  readonly detail: string | undefined;
  readonly url: string;
  /**
   * The gateway's error code, when it sent one: `quota_exceeded`, `rate_limited`,
   * `origin_not_allowed`, `plan_does_not_include_route`.
   */
  readonly code: string | undefined;
  /** For `quota_exceeded`: when the key's day or billing cycle ends and requests work again. */
  readonly resetsAt: Date | undefined;

  constructor(
    message: string,
    status: number,
    url: string,
    detail?: string,
    extra: { code?: string; resetsAt?: Date } = {},
  ) {
    super(message);
    this.name = "ForeshadowError";
    this.status = status;
    this.url = url;
    this.detail = detail;
    this.code = extra.code;
    this.resetsAt = extra.resetsAt;
  }

  /**
   * True when retrying later may help (rate limits, no data yet, server or network trouble).
   * A used-up quota isn't: it stays blocked until `resetsAt`.
   */
  get retryable(): boolean {
    if (this.code === "quota_exceeded") return false;
    return this.status === 0 || this.status === 429 || this.status === 503 || this.status >= 500;
  }
}
