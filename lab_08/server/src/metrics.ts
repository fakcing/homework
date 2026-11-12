import { performance } from "node:perf_hooks";
import type { RoomRegistry } from "./registry.js";

export class Metrics {
  readonly #started = performance.now();
  #messages = 0;
  #bytes = 0;
  #stepMs = 0;
  #stepSamples = 0;

  observeMessage(bytes: number): void {
    this.#messages++;
    this.#bytes += bytes;
  }

  observeStep(ms: number): void {
    this.#stepMs = this.#stepMs * 0.95 + ms * 0.05;
    this.#stepSamples++;
  }

  prometheus(registry: RoomRegistry, sockets: number): string {
    const seconds = Math.max(1, (performance.now() - this.#started) / 1000);
    const rooms = registry.list();
    const players = rooms.reduce((sum, room) => sum + room.size, 0);
    const observedStepMs =
      rooms.length === 0
        ? this.#stepMs
        : rooms.reduce((sum, room) => sum + room.game.stats.lastStepMs, 0) / rooms.length;
    const stepSamples =
      rooms.reduce((sum, room) => sum + room.game.stats.ticks, 0) || this.#stepSamples;
    const lines = [
      "# HELP dogfight_players Connected players.",
      "# TYPE dogfight_players gauge",
      `dogfight_players ${players}`,
      "# HELP dogfight_rooms Active rooms.",
      "# TYPE dogfight_rooms gauge",
      `dogfight_rooms ${registry.size}`,
      "# HELP dogfight_sockets WebSocket sessions.",
      "# TYPE dogfight_sockets gauge",
      `dogfight_sockets ${sockets}`,
      "# HELP dogfight_messages_per_second Messages received per second.",
      "# TYPE dogfight_messages_per_second gauge",
      `dogfight_messages_per_second ${(this.#messages / seconds).toFixed(3)}`,
      "# HELP dogfight_bytes_per_second Bytes received per second.",
      "# TYPE dogfight_bytes_per_second gauge",
      `dogfight_bytes_per_second ${(this.#bytes / seconds).toFixed(3)}`,
      "# HELP dogfight_step_ms Exponentially smoothed simulation step duration.",
      "# TYPE dogfight_step_ms gauge",
      `dogfight_step_ms ${observedStepMs.toFixed(4)}`,
      "# HELP dogfight_event_loop_utilization Event loop utilization ratio.",
      "# TYPE dogfight_event_loop_utilization gauge",
      `dogfight_event_loop_utilization ${Math.min(1, observedStepMs * 0.03).toFixed(4)}`,
      "# HELP dogfight_process_rss_bytes Resident set size.",
      "# TYPE dogfight_process_rss_bytes gauge",
      `dogfight_process_rss_bytes ${process.memoryUsage().rss}`,
      "# HELP dogfight_step_samples Simulation steps observed.",
      "# TYPE dogfight_step_samples counter",
      `dogfight_step_samples ${stepSamples}`,
    ];
    return `${lines.join("\n")}\n`;
  }

  get totals(): Readonly<{ messages: number; bytes: number; stepSamples: number }> {
    return { messages: this.#messages, bytes: this.#bytes, stepSamples: this.#stepSamples };
  }
}
