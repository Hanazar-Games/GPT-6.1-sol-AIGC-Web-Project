import { clamp } from "./physics.js";
export function formatLap(seconds) {
  if (seconds == null || !Number.isFinite(seconds)) return "—:——.——";
  const centiseconds = Math.floor(Math.max(0, seconds) * 100);
  return `${Math.floor(centiseconds / 6000)}:${String(Math.floor(centiseconds / 100) % 60).padStart(2, "0")}.${String(centiseconds % 100).padStart(2, "0")}`;
}
export class LapTracker {
  constructor(progress = 0, elapsed = 0) {
    this.laps = 0;
    this.best = null;
    this.last = null;
    this.previous = progress;
    this.distance = 0;
    this.startedAt = elapsed;
    this.valid = progress < 1e-6;
  }
  reanchor(progress, elapsed) {
    this.previous = progress;
    this.distance = 0;
    this.startedAt = elapsed;
    this.valid = false;
  }
  observe(progress, elapsed) {
    let delta = progress - this.previous;
    if (delta > 0.5) delta -= 1;
    if (delta < -0.5) delta += 1;
    const crossed = delta > 0 && this.previous > 0.75 && progress < 0.25;
    this.previous = progress;
    // A reset/teleport cannot create a fast lap by skipping part of the circuit.
    if (Math.abs(delta) > 0.08) {
      this.reanchor(progress, elapsed);
      return false;
    }
    this.distance = clamp(this.distance + delta, 0, 2);
    if (!crossed) return false;
    const complete = this.valid && this.distance >= 0.9;
    if (complete) {
      this.last = Math.max(0, elapsed - this.startedAt);
      this.best =
        this.best == null ? this.last : Math.min(this.best, this.last);
      this.laps++;
    }
    this.startedAt = elapsed;
    this.distance = progress;
    this.valid = true;
    return complete;
  }
  current(elapsed) {
    return Math.max(0, elapsed - this.startedAt);
  }
}
