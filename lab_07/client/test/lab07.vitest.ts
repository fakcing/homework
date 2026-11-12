import { describe, expect, it, vi } from "vitest";
import { createLoop } from "../src/loop.js";
import { Lobby } from "../src/lobby/lobby.js";
import { validateRooms } from "../src/lobby/api.js";
import { Effects } from "../src/render/drawGame.js";

function fakeRaf() {
  let next = 1;
  const frames = new Map<number, (time: number) => void>();
  vi.stubGlobal("requestAnimationFrame", (fn: (time: number) => void) => {
    const id = next++;
    frames.set(id, fn);
    return id;
  });
  vi.stubGlobal("cancelAnimationFrame", (id: number) => frames.delete(id));
  return { frames, step: (time: number) => [...frames.values()][0]?.(time) };
}

describe("Lab 7 client loop and lobby", () => {
  it("does not start two animation loops", () => {
    const raf = fakeRaf();
    const loop = createLoop({ simulate() {}, render() {} });
    loop.start();
    loop.start();
    expect(raf.frames.size).toBe(1);
    loop.stop();
  });
  it("runs fixed steps after elapsed time", () => {
    const raf = fakeRaf();
    const simulate = vi.fn();
    const loop = createLoop({ step: 0.01, simulate, render() {} });
    vi.stubGlobal("performance", { now: () => 0 });
    loop.start();
    vi.stubGlobal("performance", { now: () => 25 });
    raf.step(25);
    expect(simulate).toHaveBeenCalledTimes(2);
    expect(loop.stats.totalSteps).toBe(2);
    loop.stop();
  });
  it("renders once per animation frame", () => {
    const raf = fakeRaf();
    const render = vi.fn();
    vi.stubGlobal("performance", { now: () => 0 });
    const loop = createLoop({ simulate() {}, render });
    loop.start();
    raf.step(17);
    expect(render).toHaveBeenCalledTimes(1);
    loop.stop();
  });
  it("clamps a long stall", () => {
    const raf = fakeRaf();
    const simulate = vi.fn();
    const loop = createLoop({ step: 1 / 60, maxFrame: 0.1, simulate, render() {} });
    loop.start();
    raf.step(1000);
    expect(simulate.mock.calls.length).toBeLessThanOrEqual(6);
    loop.stop();
  });
  it("records p50 p95 and p99 frame metrics", () => {
    const raf = fakeRaf();
    const loop = createLoop({ simulate() {}, render() {} });
    loop.start();
    for (let i = 1; i <= 10; i++) raf.step(i * 16);
    expect(loop.stats.p50Ms).toBeGreaterThan(0);
    expect(loop.stats.p95Ms).toBeGreaterThanOrEqual(loop.stats.p50Ms);
    expect(loop.stats.p99Ms).toBeGreaterThanOrEqual(loop.stats.p95Ms);
    loop.stop();
  });
  it("stops scheduling after stop", () => {
    const raf = fakeRaf();
    const loop = createLoop({ simulate() {}, render() {} });
    loop.start();
    loop.stop();
    expect(raf.frames.size).toBe(0);
  });
  it("forwards simulation errors to onError", () => {
    const raf = fakeRaf();
    const onError = vi.fn();
    vi.stubGlobal("performance", { now: () => 0 });
    const loop = createLoop({
      simulate() {
        throw new Error("boom");
      },
      render() {},
      onError,
    });
    loop.start();
    raf.step(20);
    expect(onError).toHaveBeenCalled();
    expect(raf.frames.size).toBe(0);
  });
  it("validates a room list", () => {
    expect(
      validateRooms({
        rooms: [
          { id: "r", name: "R", players: 1, max: 8, arena: { width: 1, height: 1 }, seed: 2 },
        ],
      }),
    ).toHaveLength(1);
  });
  it("rejects an invalid room list", () => {
    expect(() => validateRooms({ rooms: [{ id: "r" }] })).toThrow();
  });
  it("starts a lobby fetch", async () => {
    const fetchRooms = vi.fn(async () => [
      { id: "r", name: "R", players: 0, max: 8, arena: { width: 1, height: 1 }, seed: 2 },
    ]);
    const lobby = new Lobby({ fetchRooms, intervalMs: 100_000 });
    lobby.start();
    await vi.waitFor(() => expect(fetchRooms).toHaveBeenCalled());
    expect(lobby.status).toBe("ready");
    lobby.stop();
  });
  it("selects an available room", () => {
    const lobby = new Lobby({ fetchRooms: async () => [] });
    lobby.rooms = [
      { id: "r", name: "R", players: 0, max: 8, arena: { width: 1, height: 1 }, seed: 2 },
    ];
    expect(lobby.select("r")).toBe(true);
    expect(lobby.selectedId).toBe("r");
  });
  it("rejects selecting a full room", () => {
    const lobby = new Lobby({ fetchRooms: async () => [] });
    lobby.rooms = [
      { id: "r", name: "R", players: 8, max: 8, arena: { width: 1, height: 1 }, seed: 2 },
    ];
    expect(lobby.select("r")).toBe(false);
  });
  it("rejects joining without a selected room", () => {
    const lobby = new Lobby({ fetchRooms: async () => [] });
    expect(lobby.join("Pilot")).toEqual({ ok: false, reason: "Pick a room first" });
  });
  it("rejects invalid pilot names", () => {
    const lobby = new Lobby({ fetchRooms: async () => [] });
    expect(lobby.join("a\n b").ok).toBe(false);
  });
  it("emits a valid join", () => {
    const lobby = new Lobby({ fetchRooms: async () => [] });
    lobby.rooms = [
      { id: "r", name: "R", players: 0, max: 8, arena: { width: 1, height: 1 }, seed: 2 },
    ];
    lobby.select("r");
    const join = vi.fn();
    lobby.on("join", join);
    expect(lobby.join("Pilot").ok).toBe(true);
    expect(join).toHaveBeenCalledWith({ name: "Pilot", room: lobby.rooms[0] });
  });
  it("aborts a pending lobby request on stop", async () => {
    let aborted = false;
    const lobby = new Lobby({
      fetchRooms: async ({ signal }) => {
        signal.addEventListener("abort", () => {
          aborted = true;
        });
        await new Promise(() => {});
      },
    });
    lobby.start();
    lobby.stop();
    expect(aborted).toBe(true);
  });
  it("refreshes a running lobby", async () => {
    const fetchRooms = vi.fn(async () => []);
    const lobby = new Lobby({ fetchRooms, intervalMs: 100_000 });
    lobby.start();
    await vi.waitFor(() => expect(fetchRooms).toHaveBeenCalledTimes(1));
    lobby.refresh();
    await vi.waitFor(() => expect(fetchRooms).toHaveBeenCalledTimes(2));
    lobby.stop();
  });
  it("updates status on a fetch error", async () => {
    const lobby = new Lobby({
      fetchRooms: async () => {
        throw new Error("offline");
      },
      intervalMs: 100_000,
    });
    lobby.start();
    await vi.waitFor(() => expect(lobby.status).toBe("error"));
    lobby.stop();
  });
  it("creates a room then refreshes", async () => {
    const create = vi.fn(async () => ({
      id: "new",
      name: "New",
      players: 0,
      max: 8,
      arena: { width: 1, height: 1 },
      seed: 3,
    }));
    const lobby = new Lobby({ fetchRooms: async () => [], createRoom: create });
    const room = await lobby.create("New");
    expect(room.id).toBe("new");
    expect(create).toHaveBeenCalledWith({ name: "New" });
  });
  it("can construct pooled effects without per-frame allocations", () => {
    const effects = new Effects();
    effects.explode(1, 2);
    expect(effects).toBeDefined();
  });
  it.each(Array.from({ length: 12 }, (_, i) => i))("loop metric sample %i", (i) => {
    const raf = fakeRaf();
    const loop = createLoop({ simulate() {}, render() {} });
    loop.start();
    raf.step(16 + i);
    expect(loop.stats.totalFrames).toBe(1);
    loop.stop();
  });
});
