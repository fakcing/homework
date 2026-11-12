import pino from "pino";

export type LogFields = Readonly<Record<string, unknown>>;
export interface Logger {
  info(msg: string, extra?: LogFields): void;
  warn(msg: string, extra?: LogFields): void;
  error(msg: string, extra?: LogFields): void;
  close(): Promise<void>;
}

const SENSITIVE = /password|pass|secret|token|key|authorization/i;
const safeFields = (fields: LogFields): LogFields =>
  Object.fromEntries(Object.entries(fields).filter(([key]) => !SENSITIVE.test(key)));

/** Structured JSON logs. No secrets are accepted by this adapter; callers pass room/player ids only. */
export function createLogger(filePath: string, { echo = true }: { echo?: boolean } = {}): Logger {
  const file = pino.destination({ dest: filePath, sync: true });
  const streams: pino.StreamEntry[] = [{ stream: file }];
  if (echo) streams.push({ stream: process.stdout });
  const logger = pino(
    { base: null, timestamp: pino.stdTimeFunctions.isoTime },
    pino.multistream(streams),
  );
  const write =
    (level: "info" | "warn" | "error") =>
    (msg: string, extra: LogFields = {}): void =>
      logger[level]({ msg, ...safeFields(extra) });
  return {
    info: write("info"),
    warn: write("warn"),
    error: write("error"),
    close: () =>
      new Promise<void>((resolve) => {
        const finish = (): void => {
          logger.flush();
          file.flushSync();
          file.once("close", resolve);
          file.end();
        };
        finish();
      }),
  };
}
