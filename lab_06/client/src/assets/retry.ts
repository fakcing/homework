import { HttpError } from "./errors.js";

type Timer = ReturnType<typeof setTimeout>;

export function abortableSleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(signal.reason);
    const timer: Timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    function onAbort(): void {
      clearTimeout(timer);
      reject(signal?.reason);
    }
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

/** Retry transient failures only: network errors, timeouts, 5xx, 408, 429. Never 4xx, never abort. */
export function isRetryable(err: unknown): boolean {
  if (err instanceof HttpError)
    return err.status >= 500 || err.status === 408 || err.status === 429;
  if (err instanceof Error && err.name === "TimeoutError") return true;
  if (err instanceof Error && err.name === "AbortError") return false;
  return err instanceof TypeError; // fetch network failure
}

export interface RetryOptions {
  retries?: number;
  baseMs?: number;
  maxMs?: number;
  signal?: AbortSignal | undefined;
  random?: () => number;
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
  onRetry?: (info: { attempt: number; delay: number; error: unknown }) => void;
}

/** Exponential backoff with full jitter: delay = random(0, min(maxMs, baseMs * 2^attempt)). */
export async function withRetry<T>(
  fn: (attempt: number) => Promise<T>,
  {
    retries = 3,
    baseMs = 250,
    maxMs = 4000,
    signal,
    random = Math.random,
    sleep = abortableSleep,
    onRetry,
  }: RetryOptions = {},
): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn(attempt);
    } catch (error: unknown) {
      if (attempt >= retries || signal?.aborted || !isRetryable(error)) throw error;
      const delay = random() * Math.min(maxMs, baseMs * 2 ** attempt);
      onRetry?.({ attempt: attempt + 1, delay, error });
      await sleep(delay, signal);
    }
  }
}
