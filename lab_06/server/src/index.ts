import { createApp } from "./app.js";
import { ConfigError, loadConfig } from "./config.js";
import type { Config } from "./config.js";

let config: Config;
try {
  config = loadConfig();
} catch (err: unknown) {
  if (!(err instanceof ConfigError)) throw err;
  console.error(err.message);
  process.exit(2);
}

const app = createApp(config);
await app.start();
for (const name of ["Alpha Station", "Nebula Run"]) app.registry.create({ name });

let shuttingDown = false;
async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  app.logger.info("shutting down", { signal });
  try {
    await app.stop();
    process.exit(0);
  } catch (err: unknown) {
    console.error("shutdown failed:", err);
    process.exit(1);
  }
}
process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));
