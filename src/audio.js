export class EngineAudio {
  constructor() {
    this.enabled = false;
    this.ctx = null;
  }
  async toggle() {
    if (!this.ctx) {
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      if (!AudioContext) return false;
      this.ctx = new AudioContext();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0;
      this.master.connect(this.ctx.destination);
      this.engine = this.ctx.createOscillator();
      this.engine.type = "sawtooth";
      const filter = this.ctx.createBiquadFilter();
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
    this.enabled = !this.enabled;
    this.master.gain.setTargetAtTime(
      this.enabled ? 0.5 : 0,
      this.ctx.currentTime,
      0.1,
    );
    return this.enabled;
  }
  update(speed, throttle, drift, playing) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const rpm = 45 + (speed % 12) * 9 + (throttle ? 18 : 0);
    this.engine.frequency.setTargetAtTime(playing ? rpm : 35, t, 0.12);
    this.sub.frequency.setTargetAtTime(playing ? rpm * 0.5 : 23, t, 0.1);
    this.engineGain.gain.setTargetAtTime(
      playing ? (throttle ? 0.08 : 0.035) : 0.012,
      t,
      0.1,
    );
    this.tires.gain.setTargetAtTime(playing && drift ? 0.1 : 0, t, 0.08);
  }
}
