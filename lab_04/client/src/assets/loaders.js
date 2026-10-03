import { BadPayloadError } from "./errors.js";
import { fetchJson, fetchResponse } from "./net.js";

export const loadJson = (url, options) => fetchJson(url, options);

export async function loadBinary(url, options) {
  return (await fetchResponse(url, options)).arrayBuffer();
}

/** fetch -> blob -> ImageBitmap: unlike `new Image()` this can be aborted with a signal. */
export async function loadImage(url, options) {
  const blob = await (await fetchResponse(url, options)).blob();
  try {
    return await createImageBitmap(blob);
  } catch (cause) {
    throw new BadPayloadError(`Cannot decode image ${url}`, { cause });
  }
}

/** Decoded on load with an OfflineAudioContext: no user gesture needed, buffers work in any context. */
export async function loadAudio(url, options) {
  const data = await loadBinary(url, options);
  try {
    return await new OfflineAudioContext(1, 1, 44100).decodeAudioData(data);
  } catch (cause) {
    throw new BadPayloadError(`Cannot decode audio ${url}`, { cause });
  }
}

export const defaultLoaders = { json: loadJson, image: loadImage, audio: loadAudio };
