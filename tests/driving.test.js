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
const { spawn, nearestRoad, samples, tangents, HALF_WIDTH } = await import(
  "../src/world.js"
);
test("a sustained drive completes the actual circuit with finite stable physics", () => {
  const start = spawn(),
    car = createCarState(start.x, start.z, start.yaw);
  const laps = new LapTracker(nearestRoad(car.x, car.z).progress);
  let collisions = 0,
    maxSpeed = 0;
  const dt = 1 / 120;
  const spacing = samples[0].distanceTo(samples[1]);
  const headings = tangents.map((t) => Math.atan2(t.x, t.z));
  const curvature = headings.map(
    (angle, i) =>
      Math.abs(
        wrapAngle(
          headings[(i + 8) % samples.length] -
            headings[(i - 8 + samples.length) % samples.length],
        ),
      ) /
      (16 * spacing),
  );
  for (let i = 0; i < 180 / dt; i++) {
    const road = nearestRoad(car.x, car.z);
    const target =
      samples[
        (road.index + Math.round((4 + car.speed * 0.7) / spacing)) %
          samples.length
      ];
    const error = wrapAngle(
      Math.atan2(target.x - car.x, target.z - car.z) - car.yaw,
    );
    // Brake for the upcoming bend using a lateral-acceleration budget. The old
    // arcade driver held 17 m/s through hairpins irrespective of tire adhesion.
    let bend = 0.001;
    for (let j = 0; j < 80; j += 4)
      bend = Math.max(bend, curvature[(road.index + j) % samples.length]);
    const targetSpeed = Math.min(17, Math.sqrt((0.65 * 9.81) / bend));
    const wheelAngle = Math.atan(
      (2 * 2.55 * Math.sin(error)) /
        Math.max(1, Math.hypot(target.x - car.x, target.z - car.z)),
    );
    stepCar(
      car,
      {
        throttle: car.speed < targetSpeed,
        reverse: car.speed > targetSpeed + 0.8,
        steer: clamp(wheelAngle / (0.5 / (1 + car.speed / 30)), -1, 1),
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
