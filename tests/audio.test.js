import test from "node:test";
import assert from "node:assert/strict";
import { EngineAudio } from "../src/audio.js";
class Parameter {
  constructor() {
    this.value = 0;
  }
  setTargetAtTime(v) {
    this.value = v;
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
  async resume() {}
}
globalThis.window = { AudioContext };
test("pause mutes all audio immediately without waiting for an animation frame", async () => {
  const audio = new EngineAudio();
  assert(await audio.toggle());
  assert.equal(audio.master.gain.value, 0);
  audio.setActive(true);
  assert(audio.master.gain.value > 0);
  audio.update(30, true, true, true);
  assert(audio.tires.gain.value > 0);
  audio.setActive(false);
  assert.equal(audio.master.gain.value, 0);
  audio.setActive(true);
  assert(audio.master.gain.value > 0);
  await audio.toggle();
  assert.equal(audio.master.gain.value, 0);
});
