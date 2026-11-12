type Timer = ReturnType<typeof setTimeout>;

export interface TickerOptions {
  readonly hz: number;
  readonly onTick: () => void;
  readonly now?: () => number;
  readonly schedule?: (fn: () => void, ms: number) => Timer;
  readonly cancel?: (timer: Timer) => void;
  readonly maxCatchUp?: number;
}

export interface Ticker {
  readonly stats: { ticks: number; skipped: number; maxLateMs: number };
  readonly running: boolean;
  start(): void;
  stop(): void;
}

/**
 * Fixed-rate loop WITHOUT setInterval. Each tick has a target time (start + n * period). After every wake-up we
 * run all ticks that are due and then sleep until the NEXT target, so a late timer (GC, busy loop, coarse OS timer)
 * is compensated instead of accumulating drift. Far behind (> maxCatchUp ticks): skip ahead rather than spiral.
 */
export function createTicker({
  hz,
  onTick,
  now = () => performance.now(),
  schedule = (fn, ms) => setTimeout(fn, ms),
  cancel = (t) => clearTimeout(t),
  maxCatchUp = 5,
}: TickerOptions): Ticker {
  const period = 1000 / hz;
  const stats = { ticks: 0, skipped: 0, maxLateMs: 0 };
  let next = 0;
  let timer: Timer | null = null;
  let running = false;

  function loop(): void {
    if (!running) return;
    const t = now();
    stats.maxLateMs = Math.max(stats.maxLateMs, t - next);
    for (let n = 0; t >= next && n < maxCatchUp; n++) {
      onTick();
      stats.ticks++;
      next += period;
    }
    if (t >= next) {
      const missed = Math.floor((t - next) / period) + 1;
      stats.skipped += missed;
      next += missed * period;
    }
    timer = schedule(loop, Math.max(0, next - now()));
  }

  return {
    stats,
    get running() {
      return running;
    },
    start() {
      if (running) return;
      running = true;
      next = now() + period;
      timer = schedule(loop, period);
    },
    stop() {
      running = false;
      if (timer !== null) cancel(timer);
    },
  };
}
