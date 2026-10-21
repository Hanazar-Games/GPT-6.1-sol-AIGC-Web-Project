import test from "node:test";
import assert from "node:assert/strict";
import { createEnvironment } from "./support/environment.js";
import {
  createCarState,
  stepCar,
  resolveBarrier,
  clamp,
  wrapAngle,
} from "../src/physics.js";
import { LapTracker } from "../src/laps.js";
createEnvironment();
const { spawn, nearestRoad, samples, HALF_WIDTH } = await import(
  "../src/world.js"
);
test("a sustained drive completes the actual circuit with finite stable physics", () => {
  const start = spawn(),
    car = createCarState(start.x, start.z, start.yaw);
  const laps = new LapTracker(nearestRoad(car.x, car.z).progress);
  let collisions = 0,
    maxSpeed = 0;
  const dt = 1 / 120;
  for (let i = 0; i < 180 / dt; i++) {
    const road = nearestRoad(car.x, car.z);
    const target = samples[(road.index + 20) % samples.length];
    const error = wrapAngle(
      Math.atan2(target.x - car.x, target.z - car.z) - car.yaw,
    );
    stepCar(
      car,
      {
        throttle: car.speed < 17,
        reverse: car.speed > 20,
        steer: clamp(error * 1.8, -1, 1),
        brake: false,
      },
      dt,
      road,
    );
    const after = nearestRoad(car.x, car.z);
    if (resolveBarrier(car, after, HALF_WIDTH)) collisions++;
    laps.observe(after.progress, (i + 1) * dt);
    maxSpeed = Math.max(maxSpeed, car.speed);
    assert(
      Number.isFinite(car.x) &&
        Number.isFinite(car.z) &&
        Number.isFinite(car.speed),
    );
    assert(Math.abs(car.x) < 200 && Math.abs(car.z) < 200);
  }
  assert(laps.laps >= 1, "must complete a timed lap after the out lap");
  assert(maxSpeed > 15);
  assert(collisions < 10, `test driver struck the rail ${collisions} times`);
});
