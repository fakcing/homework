/** Numbers for the netgraph. Rates are over the last second. */
export class NetStats {
  #in = [];
  #out = [];

  constructor() {
    this.rttMs = 0;
    this.correction = 0;
    this.correctionHistory = [];
    this.snapshots = 0;
    this.lastSnapshotAt = 0;
  }

  addIn(bytes, now) {
    this.#in.push([now, bytes]);
  }

  addOut(bytes, now) {
    this.#out.push([now, bytes]);
  }

  #rate(list, now) {
    while (list.length && now - list[0][0] > 1000) list.shift();
    return list.reduce((sum, [, b]) => sum + b, 0);
  }

  rates(now) {
    return { inBps: this.#rate(this.#in, now), outBps: this.#rate(this.#out, now) };
  }

  recordRtt(ms) {
    this.rttMs = this.rttMs ? this.rttMs * 0.8 + ms * 0.2 : ms;
  }

  recordCorrection(px) {
    this.correction = px;
    this.correctionHistory.push(px);
    if (this.correctionHistory.length > 90) this.correctionHistory.shift();
  }
}
