import { BadPayloadError } from "../assets/errors.js";

const REQUIRED = [
  "ship",
  "flame",
  "bullet",
  "bullet_homing",
  "spark",
  "pickup_repair",
  "pickup_homing",
  "asteroid_large_a",
  "asteroid_large_b",
  "asteroid_small_a",
  "asteroid_small_b",
];

/** Spritesheet (ImageBitmap) + atlas.json -> draw(ctx, frame, cx, cy, w, h, angle). */
export function createSprites(sheet, atlas) {
  const frames = atlas?.frames;
  const missing = REQUIRED.filter((name) => !frames?.[name]);
  if (missing.length) throw new BadPayloadError(`Atlas is missing frames: ${missing.join(", ")}`);

  return {
    draw(ctx, name, cx, cy, w, h, angle = 0) {
      const f = frames[name];
      ctx.save();
      ctx.translate(cx, cy);
      if (angle) ctx.rotate(angle);
      ctx.drawImage(sheet, f.x, f.y, f.w, f.h, -w / 2, -h / 2, w, h);
      ctx.restore();
    },
  };
}
