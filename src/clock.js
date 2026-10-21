// Challenge time follows active wall time, independently of bounded physics catch-up.
export class SessionClock {
  constructor(mode = "free") {
    this.reset(mode);
  }
  reset(mode) {
    this.mode = mode;
    this.remaining = 120;
    this.elapsed = 0;
  }
  advance(seconds) {
    const elapsed = Number.isFinite(seconds) ? Math.max(0, seconds) : 0;
    if (this.mode !== "challenge") {
      this.elapsed += elapsed;
      return elapsed;
    }
    const active = Math.min(elapsed, this.remaining);
    this.remaining = Math.max(0, this.remaining - active);
    if (this.remaining < 1e-8) this.remaining = 0;
    this.elapsed = 120 - this.remaining;
    return active;
  }
  get finished() {
    return this.mode === "challenge" && this.remaining === 0;
  }
}
