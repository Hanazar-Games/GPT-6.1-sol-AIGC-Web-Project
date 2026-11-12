export class FullscreenControl {
  constructor(document) {
    this.document = document;
    this.pending = false;
  }
  get active() {
    return !!this.document.fullscreenElement;
  }
  get supported() {
    return (
      !!this.document.fullscreenEnabled &&
      typeof this.document.documentElement?.requestFullscreen === "function" &&
      typeof this.document.exitFullscreen === "function"
    );
  }
  async toggle() {
    if (!this.supported || this.pending) return false;
    this.pending = true;
    try {
      if (this.active) await this.document.exitFullscreen();
      else await this.document.documentElement.requestFullscreen();
      return true;
    } finally {
      this.pending = false;
    }
  }
}
