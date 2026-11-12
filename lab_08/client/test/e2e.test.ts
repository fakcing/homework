import assert from "node:assert/strict";
import { test } from "node:test";
import { runScenario } from "../scripts/netlab.mjs";

test(
  "e2e, two real clients: prediction hides latency, binary stays in sync, chaos is detected as corrections",
  { timeout: 60000 },
  async () => {
    const base = await runScenario({ lagMs: 100, jitterMs: 10, seconds: 2 });
    assert.ok(
      base.snapshotsPerSec > 20 && base.snapshotsPerSec < 40,
      `snapshots/s ${base.snapshotsPerSec}`,
    );
    assert.ok(base.meanCorrection < 0.5, `mean correction ${base.meanCorrection}`);
    assert.ok(
      base.inputLatencyMs >= 0 && base.inputLatencyMs < 90,
      `predicted input latency ${base.inputLatencyMs}`,
    );

    const slow = await runScenario({ lagMs: 100, predict: false, seconds: 1 });
    assert.ok(
      slow.inputLatencyMs > base.inputLatencyMs + 80,
      `no prediction: ${slow.inputLatencyMs} ms vs ${base.inputLatencyMs} ms`,
    );

    const chaos = await runScenario({ lagMs: 100, chaos: 40, seconds: 2 });
    assert.ok(
      chaos.meanCorrection > Math.max(1, base.meanCorrection * 5),
      `chaos ${chaos.meanCorrection}`,
    );
  },
);
