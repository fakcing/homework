import { BUTTON } from "@dogfight/shared";

type BotRequest = { type: "tick"; seq: number };

self.onmessage = (event: MessageEvent<BotRequest>) => {
  if (event.data.type !== "tick") return;
  // Keep bot decisions deterministic and identical to a human's input payload.
  self.postMessage({ type: "input", input: { seq: event.data.seq, buttons: BUTTON.THRUST } });
};
