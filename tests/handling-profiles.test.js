import test from "node:test";
import assert from "node:assert/strict";
import { HANDLING_IDS, handlingProfile } from "../src/handling.js";
import {
  createCarState,
  stepCar,
  DriftScore,
  wrapAngle,
} from "../src/physics.js";
const road = { distance: 0, halfWidth: 10 };
function moving(speed = 18) {
  return { ...createCarState(), speed, vz: speed, throttle: 1 };
}
function drive(car, input, seconds, handling, dt = 1 / 120) {
  for (let i = 0; i < Math.round(seconds / dt); i++)
    stepCar(
      car,
      typeof input === "function" ? input(i * dt) : input,
      dt,
      road,
      handling,
    );
  return car;
}
test("all handling profiles sustain low and high entry slides and recover on lift-off", () => {
  for (const handling of HANDLING_IDS)
    for (const speed of [4, 12, 24])
      for (const direction of [-1, 1])
        for (const dt of [1 / 120, 1 / 240]) {
          const car = moving(speed);
          let peak = 0,
            drift = 0;
          for (let i = 0; i < Math.round(12 / dt); i++) {
            stepCar(
              car,
              {
                throttle: true,
                steer: i * dt < 1 ? direction : 0,
                brake: i * dt < 0.2,
              },
              dt,
              road,
              handling,
            );
            peak = Math.max(peak, car.slip);
            drift += car.drifting ? dt : 0;
          }
          assert(
            peak < 0.8,
            `${handling}/${speed}: the entry must stay catchable`,
          );
          assert(drift > 8.5 && car.slip > 0.15 && car.speed > 18);
          const speedBefore = car.speed;
          drive(car, {}, 2, handling, dt);
          assert(car.slip < 0.04 && Math.abs(car.yawRate) < 0.1);
          assert(car.rearGrip > 0.95 && car.speed > speedBefore * 0.7);
        }
});
test("handling profiles produce distinct sustained drift angles from the same inputs", () => {
  const angles = HANDLING_IDS.map(
    (id) =>
      drive(
        moving(),
        (t) => ({ throttle: 1, steer: t < 1 ? 1 : 0, brake: t < 0.2 }),
        12,
        id,
      ).slip,
  );
  assert(angles[1] > angles[0] + 0.06 && angles[2] > angles[1] + 0.06);
});
test("switching a powered wide slide to steady narrows its target progressively", () => {
  const car = drive(
    moving(),
    (t) => ({ throttle: 1, steer: t < 1 ? 1 : 0, brake: t < 0.2 }),
    4,
    "wide",
  );
  const target = car.driftTarget,
    angle = car.slip,
    steer = car.steerAngle;
  stepCar(car, { throttle: 1 }, 1 / 120, road, "steady");
  assert(
    Math.abs(car.driftTarget - target) < 0.02,
    "selection must not snap the drift target",
  );
  assert(Math.abs(car.steerAngle - steer) < 0.04);
  drive(car, { throttle: 1 }, 3, "steady");
  assert(car.slip < angle - 0.1 && car.slip > 0.15 && car.speed > 15);
});
test("left-right transitions keep their chain in every handling profile", () => {
  for (const handling of HANDLING_IDS) {
    const car = moving(20),
      score = new DriftScore();
    let positive = 0,
      negative = 0;
    for (let i = 0; i < 900; i++) {
      const t = i / 120;
      stepCar(
        car,
        { throttle: 1, steer: t < 2.5 ? 1 : t < 5 ? -1 : 1, brake: t < 0.2 },
        1 / 120,
        road,
        handling,
      );
      score.update(car, 1 / 120);
      assert.equal(score.lastBank, 0);
      if (car.drifting) {
        const angle = wrapAngle(car.yaw - Math.atan2(car.vx, car.vz));
        if (angle > 0) positive += 1 / 120;
        else negative += 1 / 120;
      }
    }
    assert(positive > 2 && negative > 1 && score.chain > 500);
  }
});
test("invalid and inherited profile names safely use the balanced physics", () => {
  for (const id of ["bad", "__proto__", "constructor", null, {}]) {
    assert.equal(handlingProfile(id).id, "balanced");
    const a = drive(moving(), { throttle: 1, steer: 0.4 }, 2, id),
      b = drive(moving(), { throttle: 1, steer: 0.4 }, 2, "balanced");
    assert.deepEqual(a, b);
  }
});
test("a short countersteer tap trims the slide instead of finishing an unwanted opposite drift", () => {
  for (const handling of HANDLING_IDS) {
    const car = drive(
      moving(),
      (t) => ({ throttle: 1, steer: t < 1 ? 1 : 0, brake: t < 0.2 }),
      4,
      handling,
    );
    const before = car.driftTarget;
    drive(car, { throttle: 1, steer: -1 }, 0.05, handling);
    const trimmed = car.driftTarget;
    assert(trimmed < before && trimmed > 0);
    drive(car, { throttle: 1 }, 1.5, handling);
    assert(
      Math.abs(car.driftTarget - trimmed) < 0.02,
      "neutral steering must retain the adjustment actually requested",
    );
    assert(wrapAngle(car.yaw - Math.atan2(car.vx, car.vz)) > 0.1);
  }
});
