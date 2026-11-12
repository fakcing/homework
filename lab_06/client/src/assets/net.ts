import { BadPayloadError, HttpError } from "./errors.js";

export interface FetchOptions extends Omit<RequestInit, "signal"> {
  signal?: AbortSignal | undefined;
  timeoutMs?: number;
}

/** fetch + `ok` check + timeout. Rejects with HttpError / TimeoutError / AbortError / TypeError. */
export async function fetchResponse(
  url: string,
  { signal, timeoutMs = 8000, ...init }: FetchOptions = {},
): Promise<Response> {
  const timeout = AbortSignal.timeout(timeoutMs);
  const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
  const response = await fetch(url, { ...init, signal: combined });
  if (!response.ok) throw new HttpError(response.status, url); // fetch does NOT reject on 404/500
  return response;
}

/** The result is `unknown`: whoever uses it must validate it (Zod), the type system cannot know what the server sent. */
export async function fetchJson(url: string, options?: FetchOptions): Promise<unknown> {
  const response = await fetchResponse(url, options);
  try {
    const data: unknown = await response.json();
    return data;
  } catch (err: unknown) {
    if (err instanceof SyntaxError)
      throw new BadPayloadError(`Malformed JSON from ${url}`, { cause: err });
    throw err; // abort/timeout while reading the body
  }
}
