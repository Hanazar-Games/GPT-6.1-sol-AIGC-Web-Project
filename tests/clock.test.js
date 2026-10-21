import test from "node:test";
import assert from "node:assert/strict";
import { SessionClock } from "../src/clock.js";
test("challenge ends after 120 active seconds at low and high frame rates", () => {
  for (const fps of [4, 30, 60, 144]) {
    const clock = new SessionClock("challenge");
    for (let frame = 0; frame < fps * 120; frame++) clock.advance(1 / fps);
    assert.equal(clock.remaining, 0);
    assert(clock.finished);
    assert.equal(clock.elapsed, 120);
  }
});
test("finishing frame cannot simulate beyond the remaining challenge time", () => {
  const clock = new SessionClock("challenge");
  clock.advance(119.9);
  assert(Math.abs(clock.advance(5) - 0.1) < 1e-10);
  assert.equal(clock.advance(5), 0);
  assert(clock.finished);
  assert.equal(clock.elapsed, 120);
  clock.reset("free");
  assert.equal(clock.elapsed, 0);
  clock.advance(1000);
  assert.equal(clock.remaining, 120);
  assert.equal(clock.elapsed, 1000);
  assert(!clock.finished);
});
