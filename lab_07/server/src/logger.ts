import { createWriteStream } from "node:fs";

export type LogFields = Readonly<Record<string, unknown>>;
export interface Logger {
  info(msg: string, extra?: LogFields): void;
  warn(msg: string, extra?: LogFields): void;
  error(msg: string, extra?: LogFields): void;
  close(): Promise<void>;
}

/** Append-only NDJSON application log; close() resolves once everything is flushed to disk. */
export function createLogger(filePath: string, { echo = true }: { echo?: boolean } = {}): Logger {
  const stream = createWriteStream(filePath, { flags: "a" });
  stream.on("error", (err) => console.error("log stream error:", err)); // no listener = process crash
  const write =
    (level: string) =>
    (msg: string, extra: LogFields = {}): void => {
      const line = JSON.stringify({ t: new Date().toISOString(), level, msg, ...extra });
      stream.write(`${line}\n`);
      if (echo) console.log(line);
    };
  return {
    info: write("info"),
    warn: write("warn"),
    error: write("error"),
    close: () => new Promise<void>((resolve) => stream.end(resolve)),
  };
}
