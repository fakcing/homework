import path from "node:path";
import { z } from "zod";

export class ConfigError extends Error {
  override readonly name = "ConfigError";
  constructor(readonly problems: readonly string[]) {
    super(`Invalid configuration:\n - ${problems.join("\n - ")}`);
  }
}

/** An empty variable counts as "not set", then the default applies. */
const unset = (v: unknown): unknown => (v === "" ? undefined : v);
const int = (def: number, min: number, max: number) =>
  z.preprocess(unset, z.coerce.number().int().min(min).max(max).default(def));
const origins = z.preprocess(unset, z.string().default("*")).transform((value) =>
  value
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean),
);

/** Everything the process reads from the environment goes through this schema: nothing else touches process.env. */
const EnvSchema = z.object({
  HOST: z.preprocess(unset, z.string().trim().min(1).default("0.0.0.0")),
  PORT: int(3000, 0, 65535), // 0 = pick a free port (tests)
  LOG_DIR: z.preprocess(unset, z.string().trim().min(1, "must not be empty").optional()),
  CLIENT_DIST: z.preprocess(unset, z.string().min(1).optional()),
  LOG_STDOUT: z.string().optional(),
  MAX_MESSAGE_BYTES: int(2048, 16, 65536),
  RATE_PER_SEC: int(10, 1, 1000),
  INPUT_RATE_PER_SEC: int(60, 1, 1000),
  JOIN_TIMEOUT_MS: int(5000, 10, 60000),
  PING_INTERVAL_MS: int(15000, 10, 120000),
  MAX_BUFFERED_BYTES: int(65536, 1, 16 * 1024 * 1024),
  MAX_ROOMS: int(100, 1, 10000),
  ROOM_MAX_PLAYERS: int(8, 2, 16),
  ALLOWED_ORIGINS: origins,
  MAX_CONNECTIONS_PER_IP: int(32, 1, 1000),
  GIT_SHA: z.preprocess(unset, z.string().trim().min(1).default("dev")),
});

export interface Config {
  readonly host: string;
  readonly port: number;
  readonly logDir: string;
  readonly clientDist: string;
  readonly logStdout: boolean;
  readonly maxMessageBytes: number;
  readonly ratePerSec: number;
  readonly inputRatePerSec: number;
  readonly joinTimeoutMs: number;
  readonly pingIntervalMs: number;
  readonly maxBufferedBytes: number;
  readonly maxRooms: number;
  readonly roomMaxPlayers: number;
  readonly allowedOrigins: readonly string[];
  readonly maxConnectionsPerIp: number;
  readonly gitSha: string;
}

/** Validates ALL variables and reports every problem at once. */
export function loadConfig(
  env: Readonly<Record<string, string | undefined>> = process.env,
  cwd: string = process.cwd(),
): Config {
  const parsed = EnvSchema.safeParse(env);
  if (!parsed.success)
    throw new ConfigError(parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`));
  const e = parsed.data;
  return Object.freeze({
    host: e.HOST,
    port: e.PORT,
    logDir: path.resolve(cwd, e.LOG_DIR ?? path.join(import.meta.dirname, "..", "logs")),
    clientDist: path.resolve(
      cwd,
      e.CLIENT_DIST ?? path.join(import.meta.dirname, "..", "..", "client", "dist"),
    ),
    logStdout: e.LOG_STDOUT !== "0",
    maxMessageBytes: e.MAX_MESSAGE_BYTES,
    ratePerSec: e.RATE_PER_SEC,
    inputRatePerSec: e.INPUT_RATE_PER_SEC,
    joinTimeoutMs: e.JOIN_TIMEOUT_MS,
    pingIntervalMs: e.PING_INTERVAL_MS,
    maxBufferedBytes: e.MAX_BUFFERED_BYTES,
    maxRooms: e.MAX_ROOMS,
    roomMaxPlayers: e.ROOM_MAX_PLAYERS,
    allowedOrigins: e.ALLOWED_ORIGINS,
    maxConnectionsPerIp: e.MAX_CONNECTIONS_PER_IP,
    gitSha: e.GIT_SHA,
  });
}
