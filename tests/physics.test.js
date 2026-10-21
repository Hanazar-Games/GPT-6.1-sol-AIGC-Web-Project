import test from "node:test";
import assert from "node:assert/strict";
import {
  createCarState,
  stepCar,
  resolveBarrier,
  DriftScore,
} from "../src/physics.js";
const road = { distance: 0, halfWidth: 10 };
function simulate(s, input, seconds, dt = 1 / 120) {
  for (let i = 0; i < seconds / dt; i++) stepCar(s, input, dt, road);
  return s;
}
test("accelerates, brakes and reverses with finite bounded speed", () => {
  const s = simulate(createCarState(), { throttle: true, steer: 0 }, 20);
  assert(s.speed > 35 && s.speed <= 55);
  simulate(s, { reverse: true, steer: 0 }, 5);
  assert(s.vz < 0 && s.vz >= -9);
  assert(Number.isFinite(s.x));
});
test("handbrake turn produces a scoreable slide", () => {
  const s = simulate(createCarState(), { throttle: true, steer: 0 }, 3);
  simulate(s, { throttle: true, steer: 1, brake: true }, 0.8);
  assert(s.slip > 0.13);
  assert(s.drifting);
});
test("fixed-time simulation remains consistent across step sizes", () => {
  const a = simulate(
      createCarState(),
      { throttle: true, steer: 0.4 },
      4,
      1 / 120,
    ),
    b = simulate(createCarState(), { throttle: true, steer: 0.4 }, 4, 1 / 240);
  assert(Math.hypot(a.x - b.x, a.z - b.z) < 0.5);
});
test("drift chain banks after grace and collision reset loses unbanked points", () => {
  const s = new DriftScore();
  for (let i = 0; i < 600; i++)
    s.update({ drifting: true, speed: 25, slip: 0.4 }, 1 / 120);
  assert(s.multiplier >= 2);
  assert(s.total === 0);
  s.update({ drifting: false }, 2);
  assert(s.total > 0);
  const saved = s.total;
  s.update({ drifting: true, speed: 20, slip: 0.5 }, 1);
  s.reset();
  assert.equal(s.total, saved);
  assert.equal(s.chain, 0);
});
test("barrier removes outward velocity and confines car", () => {
  const s = createCarState(20, 0);
  s.vx = 20;
  assert(resolveBarrier(s, { x: 0, z: 0, distance: 20 }, 10));
  assert(s.x <= 12.8);
  assert(s.vx < 0);
  assert(!resolveBarrier(s, { x: 0, z: 0, distance: 20 }, 10));
});
test("collision immediately updates telemetry and cancels drift, including cooldown contacts", () => {
  const s = createCarState(20, 0);
  s.vx = 30;
  s.speed = 30;
  s.drifting = true;
  s.x = 20;
  s.vx = 30;
  resolveBarrier(s, { x: 0, z: 0, distance: 20 }, 10);
  assert.equal(s.speed, Math.hypot(s.vx, s.vz));
  assert(!s.drifting);
  s.drifting = true;
  s.x = 20;
  s.vx = 30;
  resolveBarrier(s, { x: 0, z: 0, distance: 20 }, 10);
  assert(!s.drifting);
});
test("handbrake holds the parked car even with the throttle pressed", () => {
  const s = simulate(
    createCarState(),
    { throttle: true, steer: 0, brake: true },
    5,
  );
  assert.equal(s.speed, 0);
  assert.equal(s.z, 0);
});
test("rotated body stays inside the physical guardrail", () => {
  for (const yaw of [0, Math.PI / 4, Math.PI / 2, -Math.PI / 3]) {
    const s = createCarState(14, 0, yaw);
    s.vx = 20;
    resolveBarrier(s, { x: 0, z: 0, distance: 14 }, 10);
    const extent =
      2.15 * Math.abs(Math.sin(yaw)) + 1.05 * Math.abs(Math.cos(yaw));
    assert(s.x + extent < 13, "nose, tail and sides must all clear the rail");
  }
});
test("glancing impact preserves travel along the rail and allows an inward escape", () => {
  const s = createCarState(14, 0);
  s.vx = 3;
  s.vz = 25;
  resolveBarrier(s, { x: 0, z: 0, distance: 14 }, 10);
  assert(s.vx < 0);
  assert(s.vz > 20, "a light scrape must not repeatedly stop the car");
  s.x = 14;
  const vx = s.vx,
    vz = s.vz;
  resolveBarrier(s, { x: 0, z: 0, distance: 14 }, 10);
  assert.equal(s.vx, vx);
  assert.equal(s.vz, vz, "inward velocity should not be damped again");
});
test("another guardrail contact during cooldown still cancels a drift chain", () => {
  const s = createCarState(14, 0);
  s.vx = 10;
  assert(resolveBarrier(s, { x: 0, z: 0, distance: 14 }, 10));
  assert(s.collisionCooldown > 0);
  s.x = 14;
  s.vx = 10;
  assert(
    resolveBarrier(s, { x: 0, z: 0, distance: 14 }, 10),
    "physical contacts must not be suppressed by notification cooldown",
  );
});
