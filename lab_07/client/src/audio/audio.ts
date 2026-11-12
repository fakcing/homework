const EVENT_SOUNDS = {
  fired: "fire",
  hit: "hit",
  exploded: "explode",
  pickupTaken: "pickup",
} as const;
export type SoundName = (typeof EVENT_SOUNDS)[keyof typeof EVENT_SOUNDS];
export type AudioBuffers = Readonly<Partial<Record<string, AudioBuffer>>>;

export interface AudioApi {
  unlock(): Promise<boolean>;
  play(name: string, options?: { rate?: number }): boolean;
  attach(target: EventTarget, signal: AbortSignal): void;
  readonly state: AudioContextState | "locked";
}

/**
 * Web Audio: buffers are decoded at load time, the AudioContext is created in unlock(), which must run inside a user
 * gesture (the Join click). Until then play() is a silent no-op.
 */
export function createAudio(
  buffers: AudioBuffers = {},
  { maxVoices = 12, volume = 0.5 } = {},
): AudioApi {
  let ctx: AudioContext | null = null;
  let master: GainNode | null = null;
  let voices = 0;

  async function unlock(): Promise<boolean> {
    try {
      if (!ctx || !master) {
        ctx = new AudioContext();
        master = ctx.createGain();
        master.gain.value = volume;
        master.connect(ctx.destination);
      }
      if (ctx.state === "suspended") await ctx.resume();
    } catch (err: unknown) {
      console.warn("Audio unavailable:", err);
    }
    return ctx?.state === "running";
  }

  function play(name: string, { rate = 1 }: { rate?: number } = {}): boolean {
    const buffer = buffers[name];
    if (!ctx || !master || ctx.state !== "running" || !buffer || voices >= maxVoices) return false;
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.playbackRate.value = rate;
    source.connect(master);
    voices++;
    source.onended = () => {
      voices--;
      source.disconnect();
    };
    source.start();
    return true;
  }

  function attach(target: EventTarget, signal: AbortSignal): void {
    for (const [event, sound] of Object.entries(EVENT_SOUNDS)) {
      target.addEventListener(event, () => play(sound, { rate: 0.92 + Math.random() * 0.16 }), {
        signal,
      });
    }
  }

  return {
    unlock,
    play,
    attach,
    get state() {
      return ctx?.state ?? "locked";
    },
  };
}
