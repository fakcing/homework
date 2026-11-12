export interface NetSimOptions {
  lagMs?: number;
  jitterMs?: number;
  lossPct?: number;
  random?: () => number;
  schedule?: (fn: () => void, ms: number) => unknown;
}

export interface NetSim {
  readonly lagMs: number;
  readonly jitterMs: number;
  readonly lossPct: number;
  /** Runs fn later (or never). Returns false when the packet was "lost". */
  deliver(fn: () => void): boolean;
}

/**
 * Artificial network: `lagMs` is the round trip (half each way), `jitterMs` is +/- per packet, `lossPct` drops
 * packets. Packets may reorder (like UDP), so the server drops stale input seqs and the client stale snapshot ticks.
 */
export function createNetSim({
  lagMs = 0,
  jitterMs = 0,
  lossPct = 0,
  random = Math.random,
  schedule = (fn, ms) => setTimeout(fn, ms),
}: NetSimOptions = {}): NetSim {
  return {
    lagMs,
    jitterMs,
    lossPct,
    deliver(fn) {
      if (lossPct > 0 && random() * 100 < lossPct) return false;
      const delay = Math.max(0, lagMs / 2 + (random() * 2 - 1) * jitterMs);
      if (delay === 0) fn();
      else schedule(fn, delay);
      return true;
    },
  };
}
