import { defaultLoaders } from "./loaders.js";
import type { AssetType, Loader } from "./loaders.js";
import type { Manifest, ManifestEntry } from "./manifest.js";
import { withRetry } from "./retry.js";
import type { RetryOptions } from "./retry.js";

export interface Progress {
  key: string;
  status: "start" | "retry" | "done" | "skipped" | "failed";
  done: number;
  total: number;
  attempt?: number;
  delay?: number;
  error?: unknown;
}

export interface LoadResult {
  /** Values are `unknown` on purpose: the manifest says "image", the type system cannot know the loader's result. */
  assets: Record<string, unknown>;
  failed: { key: string; error: unknown }[];
  ms: number;
}

export interface LoadAllOptions {
  signal?: AbortSignal | undefined;
  onProgress?: (p: Progress) => void;
  mode?: "concurrent" | "sequential";
  loaders?: Readonly<Record<AssetType, Loader>>;
  retry?: RetryOptions;
}

/**
 * Loads every manifest entry. `required: false` entries (sound) may fail without failing the whole load; any required
 * failure aborts the siblings and rejects.
 */
export async function loadAll(
  manifest: Pick<Manifest, "assets">,
  {
    signal,
    onProgress = () => {},
    mode = "concurrent",
    loaders = defaultLoaders,
    retry = {},
  }: LoadAllOptions = {},
): Promise<LoadResult> {
  const entries = manifest.assets;
  const total = entries.length;
  const controller = new AbortController();
  const inner = signal ? AbortSignal.any([signal, controller.signal]) : controller.signal;
  const assets: Record<string, unknown> = {};
  const failed: { key: string; error: unknown }[] = [];
  let done = 0;
  const started = performance.now();

  async function loadOne({ key, type, src, required = true }: ManifestEntry): Promise<void> {
    const load = loaders[type];
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
    } catch (error: unknown) {
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
  } catch (error: unknown) {
    controller.abort(); // stop the siblings that are still downloading
    throw error;
  }
  return { assets, failed, ms: performance.now() - started };
}
