import { z } from "zod";
import { ARENA, BULLET, MAX_BULLETS, MAX_BUTTONS, MAX_SHIPS, SHIP } from "./constants.js";

// ---- branded ids: a `Seq` is not a `Tick` is not a `ShipId`, although all of them are numbers ----
export const ShipId = z
  .number()
  .int()
  .min(0)
  .max(MAX_SHIPS - 1)
  .brand<"ShipId">();
export const BulletId = z.number().int().min(0).max(0xffff).brand<"BulletId">();
export const Tick = z.number().int().min(0).max(0xffffffff).brand<"Tick">();
export const Seq = z.number().int().min(0).max(0xffffffff).brand<"Seq">(); // 0 = "nothing yet"
export type ShipId = z.infer<typeof ShipId>;
export type BulletId = z.infer<typeof BulletId>;
export type Tick = z.infer<typeof Tick>;
export type Seq = z.infer<typeof Seq>;

/** Anything with a position. Ships and bullets satisfy it structurally: nobody has to declare it. */
export interface Vec2 {
  readonly x: number;
  readonly y: number;
}

export interface Input {
  readonly seq: Seq;
  readonly buttons: number;
}

// ---- snapshot entities, told apart by `kind`. The schemas double as the runtime range checks. ----
const coordX = z
  .number()
  .min(0)
  .max(ARENA.width + 1);
const coordY = z
  .number()
  .min(0)
  .max(ARENA.height + 1);
const shipSpeed = z.number().min(-2000).max(2000);
const bulletSpeed = z.number().min(-3000).max(3000);

export const ShipSnap = z.object({
  kind: z.literal("ship"),
  id: ShipId,
  alive: z.boolean(),
  thrust: z.boolean(),
  invuln: z.boolean(),
  hp: z.number().int().min(0).max(SHIP.maxHp),
  cooldown: z.number().int().min(0).max(SHIP.fireCooldown),
  score: z.number().int().min(0).max(0xffff),
  angle: z
    .number()
    .min(-Math.PI - 1e-3)
    .max(Math.PI + 1e-3),
  x: coordX,
  y: coordY,
  vx: shipSpeed,
  vy: shipSpeed,
  lastSeq: Seq,
});
export const BulletSnap = z.object({
  kind: z.literal("bullet"),
  id: BulletId,
  owner: ShipId,
  ttl: z.number().int().min(0).max(BULLET.ttl),
  x: coordX,
  y: coordY,
  vx: bulletSpeed,
  vy: bulletSpeed,
  fireSeq: Seq,
});
export const SnapshotSchema = z.object({
  tick: Tick,
  ships: z.array(ShipSnap).max(MAX_SHIPS),
  bullets: z.array(BulletSnap).max(MAX_BULLETS),
});
export type ShipSnap = Readonly<z.infer<typeof ShipSnap>>;
export type BulletSnap = Readonly<z.infer<typeof BulletSnap>>;
export type Snapshot = Readonly<{
  tick: Tick;
  ships: readonly ShipSnap[];
  bullets: readonly BulletSnap[];
}>;
export type Entity = ShipSnap | BulletSnap;

export const buttonsSchema = z.number().int().min(0).max(MAX_BUTTONS);

/** What the server's world records during a tick. */
export type GameEvent =
  | { readonly type: "fire"; readonly ship: ShipId }
  | { readonly type: "hit"; readonly ship: ShipId; readonly by: ShipId }
  | { readonly type: "kill"; readonly victim: ShipId; readonly killer: ShipId }
  | { readonly type: "respawn"; readonly ship: ShipId };

/** Put it in the `default:` of a switch over a union: a variant without a `case` stops compilation. */
export function assertNever(value: never): never {
  throw new Error(`unhandled variant: ${JSON.stringify(value)}`);
}
