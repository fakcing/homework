import { createReadStream, createWriteStream } from "node:fs";
import { readdir, stat } from "node:fs/promises";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";

/** Object-mode in, NDJSON bytes out: one JSON object per line. */
export class NdjsonTransform extends Transform {
  constructor() {
    super({ writableObjectMode: true });
  }

  _transform(event, _encoding, callback) {
    try {
      callback(null, `${JSON.stringify(event)}\n`);
    } catch (error) {
      callback(error);
    }
  }
}

/** events --push--> Readable --pipeline--> NdjsonTransform --> file. Memory stays bounded by watermarks. */
export class MatchLog {
  #source = new Readable({ objectMode: true, read() {} });
  #ended = false;

  constructor(file, { onError } = {}) {
    this.file = file;
    this.error = null;
    this.done = pipeline(
      this.#source,
      new NdjsonTransform(),
      createWriteStream(file, { flags: "a" }),
    ).catch((err) => {
      this.error = err;
      onError?.(err);
    });
  }

  write(event) {
    if (!this.#ended) this.#source.push({ t: new Date().toISOString(), ...event });
  }

  /** Idempotent. Resolves when the file is fully written and closed. */
  end() {
    if (!this.#ended) {
      this.#ended = true;
      this.#source.push(null);
    }
    return this.done;
  }
}

export const MATCH_FILE_RE = /^match-[\w-]+\.ndjson$/;

export async function listMatches(dir) {
  const names = (await readdir(dir)).filter((n) => MATCH_FILE_RE.test(n));
  return Promise.all(
    names.map(async (name) => ({ name, bytes: (await stat(`${dir}/${name}`)).size })),
  );
}

/** Streams a log file to the response; pipeline() handles backpressure and cleans up on abort. */
export function streamReplay(file, size, res) {
  res.writeHead(200, { "Content-Type": "application/x-ndjson", "Content-Length": size });
  pipeline(createReadStream(file), res).catch(() => {
    /* client went away mid-download: pipeline already destroyed both streams */
  });
}
