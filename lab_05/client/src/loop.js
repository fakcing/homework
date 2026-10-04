const HISTORY = 120;

/**
 * Fixed-timestep game loop ("Fix Your Timestep!").
 * simulate(step) runs at exactly 1/step Hz; render(alpha, stats) runs once per display frame.
 * `variableStep` and `useInterval` exist only to break the loop on purpose (lab experiments).
 */
export function createLoop({
  step = 1 / 60,
  simulate,
  render,
  maxFrame = 0.25,
  variableStep = false,
  useInterval = false,
  intervalMs = 16,
  onError,
}) {
  if (typeof simulate !== "function" || typeof render !== "function") {
    throw new TypeError("createLoop: `simulate` and `render` must be functions");
  }

  const stats = {
    stepsPerSec: 0,
    framesPerSec: 0,
    frameMs: 0,
    workMs: 0,
    jitterMs: 0,
    maxFrameMs: 0,
    totalSteps: 0,
    totalFrames: 0,
  };
  const history = [];
  let running = false;
  let handle = 0;
  let last = 0;
  let accumulator = 0;
  let windowStart = 0;
  let windowSteps = 0;
  let windowFrames = 0;

  function recordFrame(t, frameMs) {
    stats.frameMs = frameMs;
    stats.totalFrames++;
    windowFrames++;

    history.push(frameMs);
    if (history.length > HISTORY) history.shift();
    const mean = history.reduce((s, v) => s + v, 0) / history.length;
    stats.jitterMs = Math.sqrt(history.reduce((s, v) => s + (v - mean) ** 2, 0) / history.length);
    stats.maxFrameMs = Math.max(...history);

    const elapsed = t - windowStart;
    if (elapsed >= 1000) {
      stats.stepsPerSec = (windowSteps * 1000) / elapsed;
      stats.framesPerSec = (windowFrames * 1000) / elapsed;
      windowStart = t;
      windowSteps = 0;
      windowFrames = 0;
    }
  }

  function runStep(dt) {
    simulate(dt);
    stats.totalSteps++;
    windowSteps++;
  }

  function fail(err) {
    stop();
    if (onError) onError(err);
    else throw err;
  }

  function frame(timestamp) {
    if (!running) return;
    const t = typeof timestamp === "number" ? timestamp : performance.now();
    const rawSeconds = (t - last) / 1000;
    last = t;
    const dt = Math.min(rawSeconds, maxFrame); // clamp: never spiral of death after a hitch

    const workStart = performance.now();
    try {
      let alpha = 1;
      if (variableStep) {
        runStep(dt);
      } else {
        accumulator += dt;
        while (accumulator >= step) {
          runStep(step);
          accumulator -= step;
        }
        alpha = accumulator / step;
      }
      render(alpha, stats);
    } catch (err) {
      fail(err);
      return;
    }
    stats.workMs = performance.now() - workStart;
    recordFrame(t, rawSeconds * 1000);

    if (!useInterval) handle = requestAnimationFrame(frame);
  }

  function start() {
    if (running) return;
    running = true;
    last = performance.now();
    windowStart = last;
    accumulator = 0;
    handle = useInterval ? setInterval(frame, intervalMs) : requestAnimationFrame(frame);
  }

  function stop() {
    running = false;
    if (useInterval) clearInterval(handle);
    else cancelAnimationFrame(handle);
  }

  return { start, stop, stats };
}
