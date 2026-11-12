import { z } from "zod";
import { BadPayloadError } from "./errors.js";
import { loadJson } from "./loaders.js";
import type { FetchOptions } from "./net.js";

const ManifestSchema = z
  .object({
    version: z.number().optional(),
    assets: z
      .array(
        z.object({
          key: z.string(),
          type: z.enum(["json", "image", "audio"]),
          src: z.string(),
          required: z.boolean().optional(),
        }),
      )
      .min(1),
  })
  .refine(
    (m) => new Set(m.assets.map((a) => a.key)).size === m.assets.length,
    "duplicate asset key",
  );

export type Manifest = z.infer<typeof ManifestSchema>;
export type ManifestEntry = Manifest["assets"][number];

export function validateManifest(data: unknown): Manifest {
  const result = ManifestSchema.safeParse(data);
  if (!result.success)
    throw new BadPayloadError(
      `Invalid manifest: ${result.error.issues[0]?.message ?? "bad shape"}`,
    );
  return result.data;
}

export async function loadManifest(url: string, options?: FetchOptions): Promise<Manifest> {
  return validateManifest(await loadJson(url, options));
}
