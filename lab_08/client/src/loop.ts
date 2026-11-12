const HISTORY = 120;

export interface LoopStats {
  stepsPerSec: number;
  framesPerSec: number;
  frameMs: number;
  workMs: number;
  jitterMs: number;
  maxFrameMs: number;
  p50Ms: number;
  p95Ms: number;
  p99Ms: number;
  totalSteps: number;
  totalFrames: number;
}

export interface LoopOptions {
  step?: number;
  simulate: (dt: number) => void;
  render: (alpha: number, stats: Readonly<LoopStats>) => void;
  maxFrame?: number;
  onError?: (err: unknown) => void;
}

export interface Loop {
  start(): void;
  stop(): void;
  readonly stats: Readonly<LoopStats>;
}

/** Fixed-timestep game loop ("Fix Your Timestep!"): simulate(step) runs at exactly 1/step Hz, render once per frame. */
export function createLoop({
  step = 1 / 60,
  simulate,
  render,
  maxFrame = 0.25,
  onError,
}: LoopOptions): Loop {
  const stats: LoopStats = {
    stepsPerSec: 0,
    framesPerSec: 0,
    frameMs: 0,
    workMs: 0,
    jitterMs: 0,
    maxFrameMs: 0,
    p50Ms: 0,
    p95Ms: 0,
    p99Ms: 0,
    totalSteps: 0,
    totalFrames: 0,
  };
  const history: number[] = [];
  let running = false;
  let handle = 0;
  let last = 0;
  let accumulator = 0;
  let windowStart = 0;
  let windowSteps = 0;
  let windowFrames = 0;

  function recordFrame(t: number, frameMs: number): void {
    stats.frameMs = frameMs;
    stats.totalFrames++;
    windowFrames++;
    history.push(frameMs);
    if (history.length > HISTORY) history.shift();
    const mean = history.reduce((s, v) => s + v, 0) / history.length;
    stats.jitterMs = Math.sqrt(history.reduce((s, v) => s + (v - mean) ** 2, 0) / history.length);
    stats.maxFrameMs = Math.max(...history);
    const sorted = [...history].sort((a, b) => a - b);
    const percentile = (p: number): number =>
      sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * p))] ?? 0;
    stats.p50Ms = percentile(0.5);
    stats.p95Ms = percentile(0.95);
    stats.p99Ms = percentile(0.99);
    const elapsed = t - windowStart;
    if (elapsed >= 1000) {
      stats.stepsPerSec = (windowSteps * 1000) / elapsed;
      stats.framesPerSec = (windowFrames * 1000) / elapsed;
      windowStart = t;
      windowSteps = 0;
      windowFrames = 0;
    }
  }

  function fail(err: unknown): void {
    stop();
    if (onError) onError(err);
    else throw err;
  }

  function frame(t: number): void {
    if (!running) return;
    const rawSeconds = (t - last) / 1000;
    last = t;
    const dt = Math.min(rawSeconds, maxFrame); // clamp: never a spiral of death after a hitch
    const workStart = performance.now();
    try {
      accumulator += dt;
      while (accumulator >= step) {
        simulate(step);
        stats.totalSteps++;
        windowSteps++;
        accumulator -= step;
      }
      render(accumulator / step, stats);
    } catch (err: unknown) {
      fail(err);
      return;
    }
    stats.workMs = performance.now() - workStart;
    recordFrame(t, rawSeconds * 1000);
    handle = requestAnimationFrame(frame);
  }

  function start(): void {
    if (running) return;
    running = true;
    last = performance.now();
    windowStart = last;
    accumulator = 0;
    handle = requestAnimationFrame(frame);
  }

  function stop(): void {
    running = false;
    cancelAnimationFrame(handle);
  }

  return { start, stop, stats };
}
