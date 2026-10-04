const OPEN = 1;

/**
 * Backpressure for WebSocket: `ws.send` never blocks, it buffers in memory. If a slow client has
 * more than `maxBuffered` bytes queued, non-critical messages (chat, presence) are dropped for it
 * instead of growing the buffer without bound. Critical ones (welcome, error) always go out.
 */
export function trySend(ws, message, { critical = false, maxBuffered = 65536, onDrop } = {}) {
  if (ws.readyState !== OPEN) return false;
  if (!critical && ws.bufferedAmount > maxBuffered) {
    onDrop?.();
    return false;
  }
  ws.send(JSON.stringify(message), (err) => {
    if (err) ws.terminate();
  });
  return true;
}

/** Snapshots are state, not events: if the client is behind, skip this one; the next supersedes it. */
export function trySendSnapshot(ws, data, { maxBuffered = 65536, onDrop } = {}) {
  if (ws.readyState !== OPEN) return false;
  if (ws.bufferedAmount > maxBuffered) {
    onDrop?.();
    return false;
  }
  ws.send(data, { binary: typeof data !== "string" }, (err) => err && ws.terminate());
  return true;
}
