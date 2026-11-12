import { BUTTON } from "@dogfight/shared";

export interface BotInput {
  readonly seq: number;
  readonly buttons: number;
}

type BotWorkerMessage = { type: "input"; input: BotInput };

/** Bots use the exact same button bit-mask as keyboard input. The worker is optional and measurable. */
export function createBotController({ useWorker = true } = {}): {
  next(): Promise<BotInput>;
  dispose(): void;
} {
  let seq = 0;
  let worker: Worker | null = null;
  const pending = new Map<number, (input: BotInput) => void>();
  if (useWorker && typeof Worker !== "undefined") {
    worker = new Worker(new URL("./botWorker.ts", import.meta.url), { type: "module" });
    worker.onmessage = (event: MessageEvent<BotWorkerMessage>) => {
      const resolve = pending.get(event.data.input.seq);
      if (resolve) {
        pending.delete(event.data.input.seq);
        resolve(event.data.input);
      }
    };
  }
  return {
    next() {
      const nextSeq = ++seq;
      if (!worker) return Promise.resolve({ seq: nextSeq, buttons: BUTTON.THRUST });
      return new Promise<BotInput>((resolve) => {
        pending.set(nextSeq, resolve);
        worker?.postMessage({ type: "tick", seq: nextSeq });
      });
    },
    dispose() {
      worker?.terminate();
      worker = null;
      pending.clear();
    },
  };
}
