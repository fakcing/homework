import { z } from "zod";
import { BadPayloadError } from "../assets/errors.js";

const AtlasSchema = z.object({
  frames: z.record(
    z.string(),
    z.object({ x: z.number(), y: z.number(), w: z.number(), h: z.number() }),
  ),
});
const REQUIRED = ["ship", "flame", "bullet", "bullet_homing", "spark"] as const;
/** Frame names are a union, so `draw(ctx, "shipp", …)` does not compile. */
export type FrameName = (typeof REQUIRED)[number];

export interface Sprites {
  draw(
    ctx: CanvasRenderingContext2D,
    name: FrameName,
    cx: number,
    cy: number,
    w: number,
    h: number,
    angle?: number,
  ): void;
}

/** Spritesheet (ImageBitmap) + atlas.json (unknown until the schema has looked at it) -> draw(). */
export function createSprites(sheet: ImageBitmap, atlasData: unknown): Sprites {
  const atlas = AtlasSchema.safeParse(atlasData);
  if (!atlas.success)
    throw new BadPayloadError(
      `Atlas has a wrong shape: ${atlas.error.issues[0]?.message ?? "invalid"}`,
    );
  const { frames } = atlas.data;
  const missing = REQUIRED.filter((name) => !frames[name]);
  if (missing.length) throw new BadPayloadError(`Atlas is missing frames: ${missing.join(", ")}`);

  return {
    draw(ctx, name, cx, cy, w, h, angle = 0) {
      const f = frames[name];
      if (!f) return;
      ctx.save();
      ctx.translate(cx, cy);
      if (angle) ctx.rotate(angle);
      ctx.drawImage(sheet, f.x, f.y, f.w, f.h, -w / 2, -h / 2, w, h);
      ctx.restore();
    },
  };
}
