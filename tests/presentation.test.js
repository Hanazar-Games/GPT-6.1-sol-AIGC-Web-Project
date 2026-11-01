import test from "node:test";
import assert from "node:assert/strict";
import { createCarState, wrapAngle } from "../src/physics.js";
import { VehiclePresentation } from "../src/presentation.js";

test("motion and wheel rotation follow physics time at low and high display refresh rates", () => {
  const step = 1 / 120;
  for (const fps of [10, 30, 60, 144, 240]) {
    const car = createCarState();
    car.speed = car.vz = 20;
    car.rearWheelSpeed = 60;
    const view = new VehiclePresentation(car);
    let accumulator = 0,
      steps = 0;
    for (let frame = 1; frame <= fps; frame++) {
      accumulator += 1 / fps;
      while (accumulator >= step) {
        steps++;
        car.z = 20 * steps * step;
        view.advance(car, step);
        accumulator -= step;
      }
      const pose = view.sample(accumulator / step),
        shownTime = Math.max(0, frame / fps - step);
      assert(
        Math.abs(pose.z - 20 * shownTime) < 1e-9,
        `${fps} Hz: fixed steps must not become visible position jumps`,
      );
      assert(Math.abs(pose.frontWheelSpin - (20 / 0.37) * shownTime) < 1e-9);
      assert(
        Math.abs(pose.rearWheelSpin - 60 * shownTime) < 1e-9,
        `${fps} Hz: wheel rotation must not slow down on catch-up frames`,
      );
    }
  }
});
test("yaw takes the short path across pi while fast wheel rotation keeps its full phase", () => {
  const car = createCarState(0, 0, Math.PI - 0.02),
    view = new VehiclePresentation(car);
  car.yaw = -Math.PI + 0.02;
  car.rearWheelSpeed = 1000;
  view.advance(car, 0.01);
  const halfway = view.sample(0.5);
  assert(Math.abs(wrapAngle(halfway.yaw - Math.PI)) < 1e-12);
  assert.equal(
    halfway.rearWheelSpin,
    5,
    "spinning wheels must not reverse through angle wrapping",
  );
});
test("render sampling is independent from live physics and never advances or mutates it", () => {
  const car = createCarState(),
    view = new VehiclePresentation(car);
  car.x = 10;
  car.roll = 0.04;
  car.pitch = -0.02;
  car.steerAngle = 0.3;
  car.rearWheelSpeed = 30;
  view.advance(car, 1 / 120);
  const before = { ...car },
    out = {};
  assert.equal(view.sample(0.5, out), out);
  assert.equal(out.x, 5);
  assert.equal(out.roll, 0.02);
  assert.equal(out.pitch, -0.01);
  assert.equal(out.steerAngle, 0.15);
  for (let i = 0; i < 100; i++) assert.deepEqual(view.sample(0.5), out);
  assert.deepEqual(car, before);
  car.x = 500;
  assert.equal(view.sample(1).x, 10, "snapshots must not alias the live car");
});
test("respawning clears old motion and wheel phases without drawing a teleport trail", () => {
  const car = createCarState(),
    view = new VehiclePresentation(car);
  car.z = 50;
  car.rearWheelSpeed = 100;
  view.advance(car, 0.1);
  const reset = createCarState(100, -30, -1);
  view.reset(reset);
  for (const alpha of [0, 0.5, 1]) {
    const pose = view.sample(alpha);
    assert.equal(pose.x, 100);
    assert.equal(pose.z, -30);
    assert.equal(pose.yaw, -1);
    assert.equal(pose.frontWheelSpin, 0);
    assert.equal(pose.rearWheelSpin, 0);
  }
});
