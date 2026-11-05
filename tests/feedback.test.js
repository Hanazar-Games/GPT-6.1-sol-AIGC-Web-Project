import test from "node:test";
import assert from "node:assert/strict";
import { createCarState } from "../src/physics.js";
import { drivingFeedback } from "../src/feedback.js";

function moving() {
  return {
    ...createCarState(),
    speed: 20,
    vz: 20,
    gear: 2,
    throttle: 1,
    drifting: true,
  };
}
test("drift angle reports mirrored directions and handles heading wrap without a full-turn jump", () => {
  const car = moving();
  car.yaw = 0.4;
  assert.equal(drivingFeedback(car).angle, "L 23°");
  car.yaw = -0.4;
  assert.equal(drivingFeedback(car).angle, "R 23°");
  car.yaw = Math.PI - 0.1;
  car.vx = Math.sin(-Math.PI + 0.1) * 20;
  car.vz = Math.cos(-Math.PI + 0.1) * 20;
  assert.equal(drivingFeedback(car).angle, "R 11°");
  car.vx = 0;
  car.vz = -8;
  car.speed = 8;
  car.yaw = 0;
  assert.equal(
    drivingFeedback(car).angle,
    "ANGLE 00°",
    "reverse travel must not display a false 180-degree drift",
  );
  car.speed = 0.1;
  assert.equal(drivingFeedback(car).angle, "ANGLE 00°");
});
test("feedback follows effective pedals and distinguishes slide, recovery, coast and brake hold", () => {
  const car = moving();
  assert.equal(drivingFeedback(car).status, "SLIDING");
  car.throttle = 0;
  assert.equal(drivingFeedback(car).status, "RECOVER");
  car.drifting = false;
  assert.equal(drivingFeedback(car).status, "COAST");
  car.serviceBrake = 0.5;
  assert.equal(drivingFeedback(car).status, "BRAKING");
  assert.equal(drivingFeedback(car).brake, 0.5);
  car.handbrake = 0.8;
  assert.equal(drivingFeedback(car).brake, 0.8);
  car.burnoutActive = true;
  car.burningOut = true;
  car.throttle = 1;
  assert.equal(drivingFeedback(car).brake, 1);
  assert.equal(drivingFeedback(car).status, "BURNOUT");
  car.burningOut = false;
  assert.equal(drivingFeedback(car, true).status, "OFF ROAD");
  assert.equal(drivingFeedback(createCarState()).status, "GRIP");
});
