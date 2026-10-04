export class HttpError extends Error {
  constructor(status, url) {
    super(`HTTP ${status} for ${url}`);
    this.name = "HttpError";
    this.status = status;
    this.url = url;
  }
}

/** The server answered, but the payload is unusable (broken JSON, undecodable image, wrong shape). */
export class BadPayloadError extends Error {
  constructor(message, options) {
    super(message, options);
    this.name = "BadPayloadError";
  }
}
