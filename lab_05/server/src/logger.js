import { createWriteStream } from "node:fs";

/** Append-only NDJSON application log; close() resolves once everything is flushed to disk. */
export function createLogger(filePath, { echo = true } = {}) {
  const stream = createWriteStream(filePath, { flags: "a" });
  stream.on("error", (err) => console.error("log stream error:", err)); // no listener = process crash
  const write =
    (level) =>
    (msg, extra = {}) => {
      const line = JSON.stringify({ t: new Date().toISOString(), level, msg, ...extra });
      stream.write(`${line}\n`);
      if (echo) console.log(line);
    };
  return {
    info: write("info"),
    warn: write("warn"),
    error: write("error"),
    close: () => new Promise((resolve) => stream.end(resolve)),
  };
}
