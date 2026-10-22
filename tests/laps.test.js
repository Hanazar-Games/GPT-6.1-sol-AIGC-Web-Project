import test from "node:test";
import assert from "node:assert/strict";
import { LapTracker, formatLap } from "../src/laps.js";
function drive(laps, start, turns, time = 0) {
  const steps = Math.round(Math.abs(turns) * 100),
    direction = Math.sign(turns);
  let completions = 0;
  for (let i = 1; i <= steps; i++) {
    const progress = (((start + (direction * i) / 100) % 1) + 1) % 1;
    if (laps.observe(progress, time + i)) completions++;
  }
  return completions;
}
test("full forward laps cross the line and retain the fastest time", () => {
  const laps = new LapTracker();
  assert.equal(drive(laps, 0, 1), 1);
  assert.equal(laps.laps, 1);
  assert.equal(laps.last, 100);
  assert.equal(laps.best, 100);
  for (let i = 1; i <= 100; i++) laps.observe((i % 100) / 100, 100 + i * 0.8);
  assert.equal(laps.laps, 2);
  assert.equal(laps.last, 80);
  assert.equal(laps.best, 80);
});
test("reversing for multiple circuits never earns forward laps", () => {
  const laps = new LapTracker();
  assert.equal(drive(laps, 0, -4), 0);
  assert.equal(laps.laps, 0);
  assert.equal(laps.best, null);
});
test("partial backward travel must be made up before a complete lap", () => {
  const laps = new LapTracker();
  drive(laps, 0, 0.4);
  drive(laps, 0.4, -0.2, 40);
  drive(laps, 0.2, 0.8, 60);
  assert.equal(laps.laps, 1);
  assert.equal(laps.last, 140);
});
test("spawn and reset laps are untimed until a new start-line crossing", () => {
  const laps = new LapTracker(0.02);
  assert(!laps.valid);
  drive(laps, 0.02, 0.98);
  assert.equal(laps.laps, 0);
  assert(laps.valid);
  drive(laps, 0, 0.5, 98);
  laps.reanchor(0.5, 148);
  drive(laps, 0.5, 0.5, 148);
  assert.equal(laps.laps, 0);
  assert(laps.valid);
  drive(laps, 0, 1, 198);
  assert.equal(laps.laps, 1);
  assert.equal(laps.best, 100);
});
test("large progress jumps invalidate rather than award shortcut lap times", () => {
  const laps = new LapTracker();
  laps.observe(0.4, 1);
  assert(!laps.valid);
  assert.equal(laps.laps, 0);
  assert.equal(formatLap(125.678), "2:05.67");
  assert.equal(formatLap(null), "—:——.——");
  assert.equal(formatLap(1e308), "—:——.——");
  assert.equal(formatLap(-5), "0:00.00");
});
