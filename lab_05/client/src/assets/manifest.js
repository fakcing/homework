import { BadPayloadError } from "./errors.js";
import { loadJson } from "./loaders.js";

const TYPES = new Set(["json", "image", "audio"]);

export function validateManifest(data) {
  if (!data || !Array.isArray(data.assets) || data.assets.length === 0) {
    throw new BadPayloadError("Manifest must contain a non-empty `assets` array");
  }
  const keys = new Set();
  for (const a of data.assets) {
    if (typeof a?.key !== "string" || typeof a.src !== "string" || !TYPES.has(a.type)) {
      throw new BadPayloadError(`Invalid manifest entry: ${JSON.stringify(a)}`);
    }
    if (keys.has(a.key)) throw new BadPayloadError(`Duplicate manifest key "${a.key}"`);
    keys.add(a.key);
  }
  return data;
}

export async function loadManifest(url, options) {
  return validateManifest(await loadJson(url, options));
}
