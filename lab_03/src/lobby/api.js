import { BadPayloadError } from "../assets/errors.js";
import { fetchJson } from "../assets/net.js";

export function validateRooms(data) {
  if (!Array.isArray(data?.rooms)) throw new BadPayloadError("`rooms` must be an array");
  return data.rooms.map((r) => {
    const ok =
      typeof r?.id === "string" &&
      typeof r.name === "string" &&
      Number.isInteger(r.players) &&
      Number.isInteger(r.max) &&
      r.arena?.width > 0 &&
      r.arena?.height > 0;
    if (!ok) throw new BadPayloadError(`Invalid room: ${JSON.stringify(r)}`);
    return r;
  });
}

export const createRoomsFetcher =
  (url = "/api/rooms") =>
  async ({ signal }) =>
    validateRooms(await fetchJson(url, { signal, timeoutMs: 60000 }));
