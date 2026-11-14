/** An error response from the API (or a network failure, with status 0). */
export class ForeshadowError extends Error {
  readonly status: number;
  /** The API's `detail` message, when it sent one. */
  readonly detail: string | undefined;
  readonly url: string;

  constructor(message: string, status: number, url: string, detail?: string) {
    super(message);
    this.name = "ForeshadowError";
    this.status = status;
    this.url = url;
    this.detail = detail;
  }

  /** True when retrying later may help (rate limits, no data yet, server or network trouble). */
  get retryable(): boolean {
    return this.status === 0 || this.status === 429 || this.status === 503 || this.status >= 500;
  }
}
