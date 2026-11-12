import { BadPayloadError } from "./errors.js";
import { fetchJson, fetchResponse } from "./net.js";
import type { FetchOptions } from "./net.js";

export type AssetType = "json" | "image" | "audio";
export type Loader = (url: string, options?: FetchOptions) => Promise<unknown>;

export const loadJson = (url: string, options?: FetchOptions): Promise<unknown> =>
  fetchJson(url, options);

export async function loadBinary(url: string, options?: FetchOptions): Promise<ArrayBuffer> {
  return (await fetchResponse(url, options)).arrayBuffer();
}

/** fetch -> blob -> ImageBitmap: unlike `new Image()` this can be aborted with a signal. */
export async function loadImage(url: string, options?: FetchOptions): Promise<ImageBitmap> {
  const blob = await (await fetchResponse(url, options)).blob();
  try {
    return await createImageBitmap(blob);
  } catch (cause: unknown) {
    throw new BadPayloadError(`Cannot decode image ${url}`, { cause });
  }
}

/** Decoded on load with an OfflineAudioContext: no user gesture needed, buffers work in any context. */
export async function loadAudio(url: string, options?: FetchOptions): Promise<AudioBuffer> {
  const data = await loadBinary(url, options);
  try {
    return await new OfflineAudioContext(1, 1, 44100).decodeAudioData(data);
  } catch (cause: unknown) {
    throw new BadPayloadError(`Cannot decode audio ${url}`, { cause });
  }
}

export const defaultLoaders: Readonly<Record<AssetType, Loader>> = {
  json: loadJson,
  image: loadImage,
  audio: loadAudio,
};
