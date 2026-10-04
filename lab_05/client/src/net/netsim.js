/**
 * Artificial network: `lagMs` is the round trip (half each way), `jitterMs` is +/- per packet,
 * `lossPct` drops packets. Applied to game packets in both directions. Packets may reorder (like UDP),
 * which is why the server drops stale input seqs and the client drops stale snapshot ticks.
 */
export function createNetSim({
  lagMs = 0,
  jitterMs = 0,
  lossPct = 0,
  random = Math.random,
  schedule = (fn, ms) => setTimeout(fn, ms),
} = {}) {
  return {
    lagMs,
    jitterMs,
    lossPct,
    /** Runs fn later (or never). Returns false when the packet was "lost". */
    deliver(fn) {
      if (lossPct > 0 && random() * 100 < lossPct) return false;
      const delay = Math.max(0, lagMs / 2 + (random() * 2 - 1) * jitterMs);
      if (delay === 0) fn();
      else schedule(fn, delay);
      return true;
    },
  };
}
