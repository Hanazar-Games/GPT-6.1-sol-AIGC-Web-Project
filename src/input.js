// Track sources independently: releasing a finger must not release a held keyboard key.
export class InputState {
  constructor() {
    this.sources = new Map();
    this.pulses = new Map();
  }
  press(source, code) {
    this.sources.set(source, code);
    // Preserve a quick handbrake tap until physics has had time to consume it.
    if (code === "Space") this.pulses.set(source, { code, remaining: 0.12 });
  }
  release(source, cancelled = false) {
    this.sources.delete(source);
    if (cancelled) this.pulses.delete(source);
  }
  has(code) {
    for (const held of this.sources.values()) if (held === code) return true;
    for (const pulse of this.pulses.values())
      if (pulse.code === code) return true;
    return false;
  }
  advance(dt) {
    let expired = false;
    for (const [source, pulse] of this.pulses) {
      pulse.remaining -= dt;
      if (pulse.remaining <= 1e-8) {
        this.pulses.delete(source);
        expired = true;
      }
    }
    return expired;
  }
  releasePointers() {
    for (const source of this.sources.keys())
      if (source.startsWith("pointer:")) this.sources.delete(source);
    for (const source of this.pulses.keys())
      if (source.startsWith("pointer:")) this.pulses.delete(source);
  }
  clear() {
    this.sources.clear();
    this.pulses.clear();
  }
}
