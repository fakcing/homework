import { z } from "zod";
import { BadPayloadError } from "../assets/errors.js";
import { fetchJson } from "../assets/net.js";

export const RoomInfoSchema = z.object({
  id: z.string(),
  name: z.string(),
  players: z.number().int(),
  max: z.number().int(),
  arena: z.object({ width: z.number().positive(), height: z.number().positive() }),
  seed: z.number().int(),
});
export type RoomInfo = z.infer<typeof RoomInfoSchema>;
const RoomsResponse = z.object({ rooms: z.array(RoomInfoSchema) });

export function validateRooms(data: unknown): RoomInfo[] {
  const result = RoomsResponse.safeParse(data);
  if (!result.success)
    throw new BadPayloadError(
      `Invalid rooms response: ${result.error.issues[0]?.message ?? "bad shape"}`,
    );
  return result.data.rooms;
}

export type FetchRooms = (options: { signal: AbortSignal }) => Promise<RoomInfo[]>;
export type CreateRoom = (options: { name: string }) => Promise<RoomInfo>;

export const createRoomsFetcher =
  (url = "/api/rooms"): FetchRooms =>
  async ({ signal }) =>
    validateRooms(await fetchJson(url, { signal, timeoutMs: 60000 }));

export const createRoomRequest: CreateRoom = async ({ name }) => {
  const data = await fetchJson("/api/rooms", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name }),
  });
  const result = RoomInfoSchema.safeParse(data);
  if (!result.success) throw new BadPayloadError("Invalid room in response");
  return result.data;
};
