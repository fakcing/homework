/**
 * Fixed-rate loop WITHOUT setInterval. Each tick has a target time (start + n * period). After
 * every wake-up we run all ticks that are due and then sleep until the NEXT target, so a late
 * timer (GC, busy loop, coarse OS timer) is compensated instead of accumulating drift.
 * If we fall more than `maxCatchUp` ticks behind we skip ahead rather than spiral.
 */
export function createTicker({
  hz,
  onTick,
  now = () => performance.now(),
  schedule = setTimeout,
  cancel = clearTimeout,
  maxCatchUp = 5,
}) {
  const period = 1000 / hz;
  const stats = { ticks: 0, skipped: 0, maxLateMs: 0 };
  let next = 0;
  let timer = null;
  let running = false;

  function loop() {
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
      next += missed * period; // way behind: drop ticks, keep the grid
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
      cancel(timer);
    },
  };
}
