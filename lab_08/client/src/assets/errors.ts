export class HttpError extends Error {
  override readonly name = "HttpError";
  constructor(
    readonly status: number,
    readonly url: string,
  ) {
    super(`HTTP ${status} for ${url}`);
  }
}

/** The server answered, but the payload is unusable (broken JSON, undecodable image, wrong shape). */
export class BadPayloadError extends Error {
  override readonly name = "BadPayloadError";
}
