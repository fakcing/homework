import { BadPayloadError, HttpError } from "./errors.js";

/** fetch + `ok` check + timeout. Rejects with HttpError / TimeoutError / AbortError / TypeError. */
export async function fetchResponse(url, { signal, timeoutMs = 8000, ...init } = {}) {
  const timeout = AbortSignal.timeout(timeoutMs);
  const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
  const response = await fetch(url, { ...init, signal: combined });
  if (!response.ok) throw new HttpError(response.status, url); // fetch does NOT reject on 404/500
  return response;
}

export async function fetchJson(url, options) {
  const response = await fetchResponse(url, options);
  try {
    return await response.json();
  } catch (err) {
    if (err instanceof SyntaxError)
      throw new BadPayloadError(`Malformed JSON from ${url}`, { cause: err });
    throw err; // abort/timeout while reading the body
  }
}
