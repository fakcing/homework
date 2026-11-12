import type { ServerMessage } from "@dogfight/shared";
import type { WebSocket } from "ws";

const OPEN = 1;
export interface SendOptions {
  readonly critical?: boolean;
  readonly maxBuffered?: number;
  readonly onDrop?: () => void;
}

/**
 * Backpressure for WebSocket: `ws.send` never blocks, it buffers in memory. If a slow client has more than
 * `maxBuffered` bytes queued, non-critical messages (chat, presence) are dropped for it instead of growing the
 * buffer without bound. Critical ones (welcome, error) always go out. `message` is a ServerMessage: the compiler
 * rejects any shape the client could not parse.
 */
export function trySend(
  ws: Pick<WebSocket, "readyState" | "bufferedAmount" | "send">,
  message: ServerMessage,
  { critical = false, maxBuffered = 65536, onDrop }: SendOptions = {},
): boolean {
  if (ws.readyState !== OPEN) return false;
  if (!critical && ws.bufferedAmount > maxBuffered) {
    onDrop?.();
    return false;
  }
  ws.send(JSON.stringify(message));
  return true;
}

/** Snapshots are state, not events: if the client is behind, skip this one; the next supersedes it. */
export function trySendSnapshot(
  ws: Pick<WebSocket, "readyState" | "bufferedAmount" | "send" | "terminate">,
  data: string | ArrayBuffer,
  { maxBuffered = 65536, onDrop }: SendOptions = {},
): boolean {
  if (ws.readyState !== OPEN) return false;
  if (ws.bufferedAmount > maxBuffered) {
    onDrop?.();
    return false;
  }
  ws.send(data, { binary: typeof data !== "string" }, (err?: Error) => {
    if (err) ws.terminate();
  });
  return true;
}
