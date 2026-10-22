import test from "node:test";
import assert from "node:assert/strict";
import { EngineAudio } from "../src/audio.js";
class Parameter {
  constructor() {
    this.value = 0;
    this.calls = 0;
  }
  setTargetAtTime(v) {
    this.value = v;
    this.calls++;
  }
}
class AudioNode {
  constructor() {
    this.gain = new Parameter();
    this.frequency = new Parameter();
    this.Q = new Parameter();
  }
  connect() {}
  start() {}
}
class AudioContext {
  constructor() {
    this.currentTime = 0;
    this.sampleRate = 100;
    this.destination = {};
    this.resumes = 0;
    this.suspends = 0;
  }
  createGain() {
    return new AudioNode();
  }
  createOscillator() {
    return new AudioNode();
  }
  createBiquadFilter() {
    return new AudioNode();
  }
  createBufferSource() {
    return new AudioNode();
  }
  createBuffer() {
    return { getChannelData: () => new Float32Array(200) };
  }
  async resume() {
    this.resumes++;
  }
  async suspend() {
    this.suspends++;
  }
}
globalThis.window = { AudioContext };
test("pause mutes all audio immediately without waiting for an animation frame", async () => {
  const audio = new EngineAudio();
  assert(await audio.toggle());
  assert.equal(audio.master.gain.value, 0);
  audio.setActive(true);
  assert(audio.master.gain.value > 0);
  audio.update({ rpm: 6000, load: 1 }, true, true);
  assert(audio.tires.gain.value > 0);
  audio.setActive(false);
  assert.equal(audio.master.gain.value, 0);
  audio.setActive(true);
  assert(audio.master.gain.value > 0);
  await audio.toggle();
  assert.equal(audio.master.gain.value, 0);
  assert.equal(audio.ctx.suspends, 1);
});
test("engine sound follows shared RPM while muted or paused updates schedule no pitch automation", async () => {
  const audio = new EngineAudio();
  await audio.toggle();
  audio.update({ rpm: 6000, load: 1 }, false, true);
  assert.equal(audio.engine.frequency.value, 200);
  assert.equal(audio.sub.frequency.value, 100);
  audio.update({ rpm: 4200, load: 0.45 }, false, true);
  assert.equal(audio.engine.frequency.value, 140);
  const calls = audio.engine.frequency.calls;
  audio.update({ rpm: 900, load: 0 }, false, false);
  assert.equal(audio.engine.frequency.calls, calls);
  await audio.toggle();
  assert.equal(
    audio.ctx.resumes,
    1,
    "muting must not require a successful context resume",
  );
  audio.update({ rpm: 7000, load: 1 }, false, true);
  assert.equal(audio.engine.frequency.calls, calls);
  await audio.toggle();
  assert.equal(audio.ctx.resumes, 2);
  audio.update({ rpm: 3000, load: 0.5 }, false, true);
  assert.equal(audio.engine.frequency.value, 100);
});
test("muting remains available after resume is blocked and enabling can be retried", async () => {
  const audio = new EngineAudio();
  await audio.toggle();
  audio.setActive(true);
  const resume = audio.ctx.resume;
  audio.ctx.resume = async () => {
    throw new Error("Audio permission unavailable");
  };
  assert.equal(await audio.toggle(), false);
  assert.equal(audio.master.gain.value, 0);
  await assert.rejects(audio.toggle(), /permission/);
  assert.equal(audio.enabled, false);
  audio.ctx.resume = resume;
  assert.equal(await audio.toggle(), true);
  assert(audio.master.gain.value > 0);
});
