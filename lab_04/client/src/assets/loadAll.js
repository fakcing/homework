import { defaultLoaders } from "./loaders.js";
import { withRetry } from "./retry.js";

/**
 * Loads every manifest entry. `required: false` entries (sound) may fail without failing the whole
 * load; any required failure aborts the siblings and rejects. mode: "concurrent" | "sequential".
 * onProgress({ key, status: start|retry|done|skipped|failed, done, total, attempt?, error? }).
 */
export async function loadAll(
  manifest,
  { signal, onProgress = () => {}, mode = "concurrent", loaders = defaultLoaders, retry = {} } = {},
) {
  const entries = manifest.assets;
  const total = entries.length;
  const controller = new AbortController();
  const inner = signal ? AbortSignal.any([signal, controller.signal]) : controller.signal;
  const assets = {};
  const failed = [];
  let done = 0;
  const started = performance.now();

  async function loadOne({ key, type, src, required = true }) {
    const load = loaders[type];
    if (!load) throw new TypeError(`No loader for asset type "${type}"`);
    onProgress({ key, status: "start", done, total });
    try {
      assets[key] = await withRetry(() => load(src, { signal: inner }), {
        ...retry,
        signal: inner,
        onRetry: ({ attempt, delay }) =>
          onProgress({ key, status: "retry", attempt, delay, done, total }),
      });
      done++;
      onProgress({ key, status: "done", done, total });
    } catch (error) {
      if (!required && !inner.aborted) {
        failed.push({ key, error });
        done++;
        onProgress({ key, status: "skipped", error, done, total });
        return;
      }
      if (!inner.aborted) onProgress({ key, status: "failed", error, done, total });
      throw error;
    }
  }

  try {
    if (mode === "sequential") for (const entry of entries) await loadOne(entry);
    else await Promise.all(entries.map(loadOne));
  } catch (error) {
    controller.abort(); // stop the siblings that are still downloading
    throw error;
  }
  return { assets, failed, ms: performance.now() - started };
}
