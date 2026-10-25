export class EngineAudio {
  constructor() {
    this.enabled = false;
    this.active = false;
    this.ctx = null;
  }
  async toggle() {
    if (this.enabled) {
      this.enabled = false;
      this.applyVolume();
      try {
        await this.ctx.suspend?.();
      } catch {}
      return false;
    }
    if (!this.ctx) {
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      if (!AudioContext) return false;
      this.ctx = new AudioContext();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0;
      this.master.connect(this.ctx.destination);
      this.engine = this.ctx.createOscillator();
      this.engine.type = "sawtooth";
      const filter = (this.filter = this.ctx.createBiquadFilter());
      filter.type = "lowpass";
      filter.frequency.value = 420;
      this.engineGain = this.ctx.createGain();
      this.engineGain.gain.value = 0.055;
      this.engine.connect(filter);
      filter.connect(this.engineGain);
      this.engineGain.connect(this.master);
      this.engine.start();
      this.sub = this.ctx.createOscillator();
      this.sub.type = "triangle";
      this.subGain = this.ctx.createGain();
      this.subGain.gain.value = 0.1;
      this.sub.connect(this.subGain);
      this.subGain.connect(this.master);
      this.sub.start();
      const buffer = this.ctx.createBuffer(
          1,
          this.ctx.sampleRate * 2,
          this.ctx.sampleRate,
        ),
        data = buffer.getChannelData(0);
      for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
      const noise = this.ctx.createBufferSource();
      noise.buffer = buffer;
      noise.loop = true;
      const band = this.ctx.createBiquadFilter();
      band.type = "bandpass";
      band.frequency.value = 1300;
      band.Q.value = 2;
      this.tires = this.ctx.createGain();
      this.tires.gain.value = 0;
      noise.connect(band);
      band.connect(this.tires);
      this.tires.connect(this.master);
      noise.start();
    }
    await this.ctx.resume();
    this.enabled = true;
    this.applyVolume();
    return this.enabled;
  }
  applyVolume() {
    if (!this.ctx) return;
    this.master.gain.setTargetAtTime(
      this.enabled && this.active ? 0.5 : 0,
      this.ctx.currentTime,
      0.04,
    );
  }
  setActive(active) {
    if (this.active === active) return;
    this.active = active;
    this.applyVolume();
  }
  update(engine, drift, playing) {
    this.setActive(playing);
    if (!this.ctx || !this.enabled || !playing) return;
    const t = this.ctx.currentTime;
    // A four-cylinder four-stroke engine fires twice per crank revolution.
    const frequency = engine.rpm / 30;
    this.engine.frequency.setTargetAtTime(frequency, t, 0.07);
    this.sub.frequency.setTargetAtTime(frequency * 0.5, t, 0.08);
    this.filter.frequency.setTargetAtTime(
      350 + engine.load * 900 + engine.rpm * 0.06,
      t,
      0.1,
    );
    this.engineGain.gain.setTargetAtTime(0.025 + engine.load * 0.055, t, 0.1);
    this.tires.gain.setTargetAtTime(
      Math.min(1, Math.max(0, Number(drift) || 0)) * 0.13,
      t,
      0.08,
    );
  }
}
