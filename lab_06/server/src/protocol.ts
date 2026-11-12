import { parseClientMessage } from "@dogfight/shared";
import type { ClientMessage } from "@dogfight/shared";

export const CLOSE = {
  GOING_AWAY: 1001,
  INVALID_PAYLOAD: 1007, // not JSON
  POLICY: 1008, // unknown type, wrong shape, wrong state, bad binary packet
  TOO_BIG: 1009,
  JOIN_TIMEOUT: 4001,
  RATE_LIMIT: 4002,
  ROOM_FULL: 4003,
  ROOM_NOT_FOUND: 4004,
} as const;

export interface Rejection {
  readonly ok: false;
  readonly code: number;
  readonly reason: string;
}
export type ParsedFrame = { readonly ok: true; readonly message: ClientMessage } | Rejection;

/** A text frame from the network: size check, JSON.parse into `unknown`, then the Zod schema. Never throws. */
export function parseTextFrame(raw: Buffer, maxBytes: number): ParsedFrame {
  if (raw.length > maxBytes) return { ok: false, code: CLOSE.TOO_BIG, reason: "message too large" };
  let json: unknown;
  try {
    json = JSON.parse(raw.toString("utf8"));
  } catch {
    return { ok: false, code: CLOSE.INVALID_PAYLOAD, reason: "invalid JSON" };
  }
  const result = parseClientMessage(json);
  return result.ok
    ? { ok: true, message: result.value }
    : { ok: false, code: CLOSE.POLICY, reason: result.reason };
}
