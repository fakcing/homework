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
