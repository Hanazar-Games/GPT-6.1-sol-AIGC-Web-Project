import test from "node:test";
import assert from "node:assert/strict";
import {
  CAR_SPEC,
  createCarState,
  stepCar,
  DriftScore,
} from "../src/physics.js";
import { Drivetrain } from "../src/drivetrain.js";
const dt = 1 / 120,
  road = { distance: 0, halfWidth: 10 };
function run(car, input, seconds) {
  for (let i = 0; i < seconds * 120; i++) stepCar(car, input, dt, road);
}
test("burnout holds the chassis while rear wheel speed drives RPM, smoke and first gear", () => {
  for (const input of [
    { burnout: true },
    { throttle: true, reverse: true },
    { burnout: true, steer: 1 },
  ]) {
    const car = createCarState(),
      engine = new Drivetrain(),
      score = new DriftScore();
    for (let i = 0; i < 1200; i++) {
      stepCar(car, input, dt, road);
      engine.update(car, input, dt);
      score.update(car, dt);
      assert.equal(engine.rpm, car.rpm);
      assert.equal(car.gear, 1);
      assert(car.speed < 0.25);
    }
    assert(Math.hypot(car.x, car.z) < 0.05);
    assert(car.rearWheelSpeed * CAR_SPEC.wheelRadius > 12);
    assert(car.rpm > 6000 && car.rpm <= 7500);
    assert(car.burningOut && car.tireSmoke > 0.8);
    assert.equal(
      score.chain + score.total,
      0,
      "stationary wheelspin cannot earn drift points",
    );
    run(car, {}, 3);
    assert(!car.burningOut && !car.burnoutActive);
    assert(car.tireSmoke < 0.05);
  }
});
test("burnout brakes a moving car without pinning it, then stops; handbrake locks rear wheels", () => {
  const car = createCarState();
  car.vz = car.speed = 20;
  run(car, { burnout: true }, 0.1);
  assert(!car.burnoutActive && car.speed > 15);
  run(car, { burnout: true }, 8);
  assert(car.burningOut && car.speed < 0.25);
  run(car, { throttle: true, brake: true }, 2);
  assert.equal(car.rearWheelSpeed, 0);
  assert.equal(car.speed, 0);
  assert(!car.burningOut && car.tireSmoke < 0.05);
});
test("releasing the front brake with throttle converts wheelspin into forward acceleration", () => {
  const car = createCarState();
  run(car, { burnout: true }, 3);
  run(car, { throttle: true }, 3);
  assert(!car.burnoutActive && car.speed > 10);
  assert(Number.isFinite(car.rearSlipRatio));
});
test("burnout from reverse brakes before spinning the rear wheels instead of accelerating backwards", () => {
  for (const input of [{ burnout: true }, { throttle: true, reverse: true }]) {
    const car = createCarState();
    car.vz = -8;
    car.speed = 8;
    car.gear = -1;
    run(car, input, 0.1);
    assert(
      car.vz < 0 && car.speed > 5,
      "the moving car must decelerate without teleporting to rest",
    );
    assert(
      car.speed < 8 && car.frontForceX > 0,
      "brakes must oppose reverse travel",
    );
    run(car, input, 5);
    assert(car.burningOut && car.speed < 0.25);
    assert(
      Math.abs(car.z) < 12,
      "a burnout request must not keep driving backwards",
    );
    assert(car.rearWheelSpeed > 30 && car.gear === 1);
  }
});
