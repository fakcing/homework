import { createApp } from "./app.js";
import { ConfigError, loadConfig } from "./config.js";

let config;
try {
  config = loadConfig();
} catch (err) {
  if (!(err instanceof ConfigError)) throw err;
  console.error(err.message);
  process.exit(2);
}

const app = createApp(config);
await app.start();
for (const name of ["Alpha Station", "Nebula Run"]) app.registry.create({ name });

let shuttingDown = false;
async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  app.logger.info("shutting down", { signal });
  try {
    await app.stop();
    process.exit(0);
  } catch (err) {
    console.error("shutdown failed:", err);
    process.exit(1);
  }
}
process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
