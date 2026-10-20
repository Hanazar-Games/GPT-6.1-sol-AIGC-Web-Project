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
    return [...this.sources.values()].includes(code);
  }
  clear() {
    this.sources.clear();
  }
}
