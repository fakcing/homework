const EVENT_SOUNDS = { fired: "fire", hit: "hit", exploded: "explode", pickupTaken: "pickup" };

/**
 * Web Audio: buffers are decoded at load time, the AudioContext is created in unlock(), which must
 * run inside a user gesture (the Join click). Until then play() is a silent no-op.
 */
export function createAudio(buffers = {}, { maxVoices = 12, volume = 0.5 } = {}) {
  let ctx = null;
  let master = null;
  let voices = 0;

  async function unlock() {
    try {
      if (!ctx) {
        ctx = new AudioContext();
        master = ctx.createGain();
        master.gain.value = volume;
        master.connect(ctx.destination);
      }
      if (ctx.state === "suspended") await ctx.resume();
    } catch (err) {
      console.warn("Audio unavailable:", err);
    }
    return ctx?.state === "running";
  }

  function play(name, { rate = 1 } = {}) {
    const buffer = buffers[name];
    if (!ctx || ctx.state !== "running" || !buffer || voices >= maxVoices) return false;
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

  /** Subscribes to the simulation's EventTarget; `signal` removes all listeners at once. */
  function attach(target, signal) {
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
