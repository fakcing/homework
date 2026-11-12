// JSON messages. The schema is the single source of truth: the TypeScript type is *derived* from it (z.infer),
// and the same schema validates untrusted data at runtime, because types are erased when the code is built.
import { z } from "zod";
import { ShipId, buttonsSchema } from "./types.js";

const Name = z
  .string()
  .trim()
  .regex(/^[\p{L}\p{N} _-]{1,16}$/u, "name: 1-16 letters, digits, space, _ or -");
const RoomId = z.string().regex(/^[\w-]{1,40}$/, "bad room id");
const InputSeq = z.number().int().min(1).max(0xffffffff).brand<"Seq">(); // same brand as `Seq`, but 0 is not a valid input

// ---- client -> server ----
export const JoinMessage = z.object({
  type: z.literal("join"),
  room: RoomId,
  name: Name,
  format: z.enum(["binary", "json"]).default("binary"),
});
export const ChatMessage = z.object({
  type: z.literal("chat"),
  text: z.string().trim().min(1, "empty chat").max(200, "chat too long"),
});
export const LeaveMessage = z.object({ type: z.literal("leave") });
export const InputMessage = z.object({
  type: z.literal("input"),
  seq: InputSeq,
  buttons: buttonsSchema,
});
export const ClientMessage = z.discriminatedUnion("type", [
  JoinMessage,
  ChatMessage,
  LeaveMessage,
  InputMessage,
]);
export type ClientMessage = z.infer<typeof ClientMessage>;
/** What a client may SEND (fields with defaults are optional). */
export type ClientMessageInput = z.input<typeof ClientMessage>;

// ---- server -> client (control messages; snapshots have their own codec) ----
const PlayerInfo = z.object({ id: z.string(), name: z.string(), slot: ShipId });
export const ServerMessage = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("welcome"),
    you: z.string(),
    slot: ShipId,
    format: z.enum(["binary", "json"]),
    tickHz: z.number().positive(),
    room: z.object({ id: z.string(), name: z.string(), max: z.number().int() }),
    players: z.array(PlayerInfo),
  }),
  z.object({ type: z.literal("joined"), player: PlayerInfo }),
  z.object({ type: z.literal("left"), id: z.string(), slot: ShipId }),
  z.object({
    type: z.literal("chat"),
    from: z.string(),
    name: z.string(),
    text: z.string(),
    ts: z.number(),
  }),
  z.object({ type: z.literal("error"), code: z.number().int(), message: z.string() }),
]);
export type ServerMessage = z.infer<typeof ServerMessage>;

export type ParseResult<T> =
  { readonly ok: true; readonly value: T } | { readonly ok: false; readonly reason: string };

function parseWith<T>(schema: z.ZodType<T>, value: unknown): ParseResult<T> {
  const result = schema.safeParse(value);
  if (result.success) return { ok: true, value: result.data };
  const issue = result.error.issues[0];
  return {
    ok: false,
    reason: issue
      ? `${issue.path.join(".") || "message"}: ${issue.message}`.slice(0, 100)
      : "invalid message",
  };
}

/** Takes `unknown` (whatever JSON.parse returned) and never throws. */
export const parseClientMessage = (value: unknown): ParseResult<ClientMessage> =>
  parseWith(ClientMessage, value);
export const parseServerMessage = (value: unknown): ParseResult<ServerMessage> =>
  parseWith(ServerMessage, value);
