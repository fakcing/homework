import { createReadStream, createWriteStream } from "node:fs";
import { readdir, stat } from "node:fs/promises";
import type { ServerResponse } from "node:http";
import { Readable, Transform } from "node:stream";
import type { TransformCallback } from "node:stream";
import { pipeline } from "node:stream/promises";

export type MatchEvent = Readonly<Record<string, unknown>> & { readonly type: string };

/** Object-mode in, NDJSON bytes out: one JSON object per line. */
export class NdjsonTransform extends Transform {
  constructor() {
    super({ writableObjectMode: true });
  }

  override _transform(
    event: unknown,
    _encoding: BufferEncoding,
    callback: TransformCallback,
  ): void {
    try {
      callback(null, `${JSON.stringify(event)}\n`);
    } catch (error: unknown) {
      callback(error instanceof Error ? error : new Error(String(error)));
    }
  }
}

/** events --push--> Readable --pipeline--> NdjsonTransform --> file. Memory stays bounded by watermarks. */
export class MatchLog {
  readonly #source = new Readable({ objectMode: true, read() {} });
  #ended = false;
  readonly file: string;
  error: Error | null = null;
  readonly done: Promise<void>;

  constructor(file: string, { onError }: { onError?: (err: Error) => void } = {}) {
    this.file = file;
    this.done = pipeline(
      this.#source,
      new NdjsonTransform(),
      createWriteStream(file, { flags: "a" }),
    ).catch((err: unknown) => {
      this.error = err instanceof Error ? err : new Error(String(err));
      onError?.(this.error);
    });
  }

  write(event: MatchEvent): void {
    if (!this.#ended) this.#source.push({ t: new Date().toISOString(), ...event });
  }

  /** Idempotent. Resolves when the file is fully written and closed. */
  end(): Promise<void> {
    if (!this.#ended) {
      this.#ended = true;
      this.#source.push(null);
    }
    return this.done;
  }
}

export const MATCH_FILE_RE = /^match-[\w-]+\.ndjson$/;

export async function listMatches(dir: string): Promise<{ name: string; bytes: number }[]> {
  const names = (await readdir(dir)).filter((n) => MATCH_FILE_RE.test(n));
  return Promise.all(
    names.map(async (name) => ({ name, bytes: (await stat(`${dir}/${name}`)).size })),
  );
}

/** Streams a log file to the response; pipeline() handles backpressure and cleans up on abort. */
export function streamReplay(file: string, size: number, res: ServerResponse): void {
  res.writeHead(200, { "Content-Type": "application/x-ndjson", "Content-Length": size });
  pipeline(createReadStream(file), res).catch(() => {
    /* client went away mid-download: pipeline already destroyed both streams */
  });
}
