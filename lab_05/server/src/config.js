import path from "node:path";

export class ConfigError extends Error {
  constructor(problems) {
    super(`Invalid configuration:\n - ${problems.join("\n - ")}`);
    this.name = "ConfigError";
    this.problems = problems;
  }
}

function readInt(env, name, fallback, min, max, problems) {
  const raw = env[name];
  if (raw === undefined || raw === "") return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < min || value > max) {
    problems.push(`${name} must be an integer in [${min}, ${max}], got "${raw}"`);
    return fallback;
  }
  return value;
}

/** Reads and validates settings from the environment; collects ALL problems before failing. */
export function loadConfig(env = process.env, cwd = process.cwd()) {
  const problems = [];
  const rawLogDir = env.LOG_DIR;
  if (rawLogDir !== undefined && rawLogDir.trim() === "")
    problems.push("LOG_DIR must not be empty");

  const config = {
    host: env.HOST?.trim() || "0.0.0.0",
    port: readInt(env, "PORT", 3000, 0, 65535, problems), // 0 = pick a free port (tests)
    logDir: path.resolve(cwd, rawLogDir?.trim() || path.join(import.meta.dirname, "..", "logs")),
    clientDist: path.resolve(
      cwd,
      env.CLIENT_DIST || path.join(import.meta.dirname, "..", "..", "client", "dist"),
    ),
    logStdout: env.LOG_STDOUT !== "0",
    maxMessageBytes: readInt(env, "MAX_MESSAGE_BYTES", 2048, 16, 65536, problems),
    ratePerSec: readInt(env, "RATE_PER_SEC", 10, 1, 1000, problems),
    inputRatePerSec: readInt(env, "INPUT_RATE_PER_SEC", 60, 1, 1000, problems),
    joinTimeoutMs: readInt(env, "JOIN_TIMEOUT_MS", 5000, 10, 60000, problems),
    pingIntervalMs: readInt(env, "PING_INTERVAL_MS", 15000, 10, 120000, problems),
    maxBufferedBytes: readInt(env, "MAX_BUFFERED_BYTES", 65536, 1, 16 * 1024 * 1024, problems),
    maxRooms: readInt(env, "MAX_ROOMS", 100, 1, 10000, problems),
    roomMaxPlayers: readInt(env, "ROOM_MAX_PLAYERS", 8, 2, 64, problems),
  };
  if (problems.length) throw new ConfigError(problems);
  return Object.freeze(config);
}
