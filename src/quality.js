export const QUALITY_MODES = ["auto", "performance", "high"];
const caps = { auto: 1.5, performance: 1, high: 2 };
const pixels = { auto: 2_000_000, performance: 1_000_000, high: 3_500_000 };
export class RenderQuality {
  constructor(mode = "auto", viewport = {}) {
    this.mode = QUALITY_MODES.includes(mode) ? mode : "auto";
    this.ratio = 1;
    this.maximum = 1;
    this.seconds = 0;
    this.frames = 0;
    this.resize(viewport, true);
  }
  resize(viewport, reset = false) {
    this.viewport = {
      width: Math.max(1, viewport.width || 1),
      height: Math.max(1, viewport.height || 1),
      dpr: Math.max(0.1, viewport.dpr || 1),
    };
    const previous = this.maximum;
    this.maximum = Math.min(
      this.viewport.dpr,
      caps[this.mode],
      Math.sqrt(
        pixels[this.mode] / (this.viewport.width * this.viewport.height),
      ),
    );
    this.minimum = Math.min(0.75, this.maximum);
    this.ratio =
      reset || this.mode !== "auto" || this.ratio >= previous - 0.01
        ? this.maximum
        : Math.max(this.minimum, Math.min(this.ratio, this.maximum));
    this.seconds = 0;
    this.frames = 0;
    return this.ratio;
  }
  setMode(mode) {
    if (!QUALITY_MODES.includes(mode)) return this.ratio;
    this.mode = mode;
    return this.resize(this.viewport, true);
  }
  sample(elapsed) {
    // Ignore suspension and long stalls; only sustained active gameplay informs quality.
    if (this.mode !== "auto" || elapsed <= 0 || elapsed > 0.25) return false;
    this.seconds += elapsed;
    this.frames++;
    if (this.seconds < 3) return false;
    const average = this.seconds / this.frames,
      before = this.ratio;
    if (average > 1 / 28)
      this.ratio = Math.max(this.minimum, this.ratio * 0.85);
    else if (average < 1 / 52)
      this.ratio = Math.min(this.maximum, this.ratio * 1.08);
    this.seconds = 0;
    this.frames = 0;
    return Math.abs(before - this.ratio) > 0.001;
  }
}
export class RenderSchedule {
  constructor() {
    this.dirty = true;
    this.last = -Infinity;
  }
  invalidate() {
    this.dirty = true;
  }
  shouldRender(
    now,
    { active = false, hidden = false, reducedMotion = false } = {},
  ) {
    if (hidden) {
      this.dirty = true;
      return false;
    }
    if (
      !this.dirty &&
      !active &&
      (reducedMotion || now - this.last < 1000 / 30 - 0.1)
    )
      return false;
    this.last = now;
    this.dirty = false;
    return true;
  }
}
