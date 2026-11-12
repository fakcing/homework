type Sample = readonly [at: number, bytes: number];

/** Numbers for the netgraph. Rates are over the last second. */
export class NetStats {
  readonly #in: Sample[] = [];
  readonly #out: Sample[] = [];
  rttMs = 0;
  correction = 0;
  readonly correctionHistory: number[] = [];
  snapshots = 0;
  lastSnapshotAt = 0;

  addIn(bytes: number, now: number): void {
    this.#in.push([now, bytes]);
  }

  addOut(bytes: number, now: number): void {
    this.#out.push([now, bytes]);
  }

  #rate(list: Sample[], now: number): number {
    while (list.length > 0 && now - (list[0]?.[0] ?? now) > 1000) list.shift();
    return list.reduce((sum, [, b]) => sum + b, 0);
  }

  rates(now: number): { inBps: number; outBps: number } {
    return { inBps: this.#rate(this.#in, now), outBps: this.#rate(this.#out, now) };
  }

  recordRtt(ms: number): void {
    this.rttMs = this.rttMs ? this.rttMs * 0.8 + ms * 0.2 : ms;
  }

  recordCorrection(px: number): void {
    this.correction = px;
    this.correctionHistory.push(px);
    if (this.correctionHistory.length > 90) this.correctionHistory.shift();
  }
}
