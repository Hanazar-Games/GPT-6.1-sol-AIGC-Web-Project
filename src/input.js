// Track sources independently: releasing a finger must not release a held keyboard key.
export class InputState {
  constructor() {
    this.sources = new Map();
  }
  press(source, code) {
    this.sources.set(source, code);
  }
  release(source) {
    this.sources.delete(source);
  }
  has(code) {
    for (const held of this.sources.values()) if (held === code) return true;
    return false;
  }
  releasePointers() {
    for (const source of this.sources.keys())
      if (source.startsWith("pointer:")) this.sources.delete(source);
  }
  clear() {
    this.sources.clear();
  }
}
