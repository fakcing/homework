import { describe, expect, it, vi } from "vitest";
import { createRateLimiter } from "../src/limiter.js";
import { createTicker } from "../src/ticker.js";
import { parseTextFrame, CLOSE } from "../src/protocol.js";
import { Room } from "../src/room.js";

const frame = (value: unknown): Buffer => Buffer.from(JSON.stringify(value));

describe("Lab 7 server timing and protocol", () => {
  it("allows a full burst", () => {
    const now = 0;
    const limiter = createRateLimiter({ perSecond: 4, now: () => now });
    expect([1, 2, 3, 4].map(() => limiter.take())).toEqual([true, true, true, true]);
  });
  it("rejects a burst over the limit", () => {
    const limiter = createRateLimiter({ perSecond: 2, now: () => 0 });
    expect(limiter.take()).toBe(true);
    expect(limiter.take()).toBe(true);
    expect(limiter.take()).toBe(false);
  });
  it("refills continuously", () => {
    let now = 0;
    const limiter = createRateLimiter({ perSecond: 2, now: () => now });
    limiter.take();
    limiter.take();
    now = 500;
    expect(limiter.take()).toBe(true);
  });
  it("caps the bucket at burst", () => {
    let now = 0;
    const limiter = createRateLimiter({ perSecond: 100, burst: 2, now: () => now });
    now = 10_000;
    expect([limiter.take(), limiter.take(), limiter.take()]).toEqual([true, true, false]);
  });
  it("ticker starts only once", () => {
    const now = 0;
    const callbacks: (() => void)[] = [];
    const ticker = createTicker({
      hz: 30,
      onTick: vi.fn(),
      now: () => now,
      schedule: (fn) => (callbacks.push(fn), 1),
      cancel: vi.fn(),
    });
    ticker.start();
    ticker.start();
    expect(ticker.running).toBe(true);
    expect(callbacks).toHaveLength(1);
  });
  it("ticker runs a due tick", () => {
    let now = 0;
    let ticks = 0;
    let callback: (() => void) | undefined;
    const ticker = createTicker({
      hz: 10,
      onTick: () => ticks++,
      now: () => now,
      schedule: (fn) => ((callback = fn), 1),
      cancel() {},
    });
    ticker.start();
    now = 100;
    callback?.();
    expect(ticks).toBe(1);
  });
  it("ticker skips a long stall instead of spiralling", () => {
    let now = 0;
    let ticks = 0;
    let callback: (() => void) | undefined;
    const ticker = createTicker({
      hz: 30,
      onTick: () => ticks++,
      now: () => now,
      schedule: (fn) => ((callback = fn), 1),
      cancel() {},
    });
    ticker.start();
    now = 10_000;
    callback?.();
    expect(ticker.stats.skipped).toBeGreaterThan(0);
    expect(ticks).toBeLessThanOrEqual(5);
  });
  it("stops and cancels the pending timer", () => {
    const cancel = vi.fn();
    const ticker = createTicker({ hz: 30, onTick() {}, schedule: () => 42, cancel });
    ticker.start();
    ticker.stop();
    expect(cancel).toHaveBeenCalledWith(42);
    expect(ticker.running).toBe(false);
  });
  it("sanitizes a join frame", () => {
    const result = parseTextFrame(frame({ type: "join", room: "r", name: " Ann " }), 2048);
    expect(result.message).toMatchObject({ type: "join", name: "Ann", format: "binary" });
  });
  it.each([
    [{ type: "chat", text: "" }, CLOSE.POLICY],
    [{ type: "input", seq: 0, buttons: 0 }, CLOSE.POLICY],
    [{ type: "join", room: "../x", name: "x" }, CLOSE.POLICY],
    [{ type: "unknown" }, CLOSE.POLICY],
  ] as const)("rejects malformed frame %#", (value, code) =>
    expect(parseTextFrame(frame(value), 2048).code).toBe(code),
  );
  it("rejects invalid JSON", () =>
    expect(parseTextFrame(Buffer.from("{"), 2048).code).toBe(CLOSE.INVALID_PAYLOAD));
  it("rejects oversized JSON", () =>
    expect(parseTextFrame(Buffer.from("x".repeat(2049)), 2048).code).toBe(CLOSE.TOO_BIG));
  it("emits room join and leave", () => {
    const room = new Room({ id: "r", name: "R", max: 2, arena: { width: 1, height: 1 }, seed: 1 });
    const events: string[] = [];
    room.on("join", () => events.push("join"));
    room.on("leave", () => events.push("leave"));
    const player = {
      id: "1",
      name: "A",
      slot: 0,
      format: "binary" as const,
      send() {},
      sendSnapshot() {},
    };
    expect(room.add(player)).toBe(true);
    expect(room.remove(player.id)).toBe(true);
    expect(events).toEqual(["join", "leave"]);
  });
  it("refuses a duplicate room player", () => {
    const room = new Room({ id: "r", name: "R", max: 2, arena: { width: 1, height: 1 }, seed: 1 });
    const player = {
      id: "1",
      name: "A",
      slot: 0,
      format: "binary" as const,
      send() {},
      sendSnapshot() {},
    };
    expect(room.add(player)).toBe(true);
    expect(room.add(player)).toBe(false);
  });
  it("refuses players after max", () => {
    const room = new Room({ id: "r", name: "R", max: 1, arena: { width: 1, height: 1 }, seed: 1 });
    const make = (id: string) => ({
      id,
      name: id,
      slot: 0,
      format: "binary" as const,
      send() {},
      sendSnapshot() {},
    });
    room.add(make("1"));
    expect(room.add(make("2"))).toBe(false);
  });
  it("selects the smallest free slot", () => {
    const room = new Room({ id: "r", name: "R", max: 4, arena: { width: 1, height: 1 }, seed: 1 });
    const p = (id: string, slot: number) => ({
      id,
      name: id,
      slot,
      format: "binary" as const,
      send() {},
      sendSnapshot() {},
    });
    room.add(p("a", 0));
    room.add(p("b", 2));
    expect(room.freeSlot()).toBe(1);
  });
  it("broadcasts chat to every player", () => {
    const room = new Room({ id: "r", name: "R", max: 2, arena: { width: 1, height: 1 }, seed: 1 });
    const sent: unknown[] = [];
    const p = (id: string) => ({
      id,
      name: id,
      slot: 0,
      format: "binary" as const,
      send: (m: unknown) => sent.push(m),
      sendSnapshot() {},
    });
    const a = p("a");
    room.add(a);
    room.add(p("b"));
    room.chat(a, "hello");
    expect(sent).toHaveLength(2);
  });
  it("records room full state", () => {
    const room = new Room({ id: "r", name: "R", max: 1, arena: { width: 1, height: 1 }, seed: 1 });
    expect(room.full).toBe(false);
    room.add({ id: "1", name: "A", slot: 0, format: "binary", send() {}, sendSnapshot() {} });
    expect(room.full).toBe(true);
  });
  it("does not remove an unknown player", () => {
    const room = new Room({ id: "r", name: "R", max: 1, arena: { width: 1, height: 1 }, seed: 1 });
    expect(room.remove("missing")).toBe(false);
  });
  it("isolates chat sender metadata", () => {
    const room = new Room({ id: "r", name: "R", max: 1, arena: { width: 1, height: 1 }, seed: 1 });
    const sent: unknown[] = [];
    const player = {
      id: "p",
      name: "Pilot",
      slot: 0,
      format: "binary" as const,
      send: (m: unknown) => sent.push(m),
      sendSnapshot() {},
    };
    room.add(player);
    room.chat(player, "safe");
    expect(sent[0]).toMatchObject({ type: "chat", name: "Pilot", text: "safe" });
  });
});
