import test from "node:test";
import assert from "node:assert/strict";
import {
  createCarState,
  stepCar,
  wrapAngle,
  DriftScore,
} from "../src/physics.js";
const dt = 1 / 120,
  road = { distance: 0, halfWidth: 10 };
function moving(speed) {
  const car = createCarState();
  car.vz = speed;
  car.speed = speed;
  car.throttle = 1;
  return car;
}
test("digital steering sustains recoverable drift across entry speeds without spinning or stalling", () => {
  for (const speed of [12, 16, 20, 24]) {
    const car = moving(speed);
    let drifting = 0,
      peak = 0,
      minimum = speed;
    for (let i = 0; i < 960; i++) {
      stepCar(car, { throttle: true, steer: 1, brake: i < 30 }, dt, road);
      if (i > 60) {
        drifting += car.drifting ? dt : 0;
        peak = Math.max(peak, car.slip);
        minimum = Math.min(minimum, car.speed);
      }
    }
    assert(
      drifting > 5.5,
      `entry ${speed}: insufficient sustained drift (${drifting}s)`,
    );
    assert(
      peak > 0.2 && peak < 0.8,
      `entry ${speed}: slide must remain catchable`,
    );
    assert(minimum > speed * 0.8, `entry ${speed}: slide must retain momentum`);
  }
});
test("left-right-left digital transitions preserve a scoring chain and neutral steering recovers", () => {
  const car = moving(18),
    score = new DriftScore();
  let positive = 0,
    negative = 0,
    peak = 0;
  for (let i = 0; i < 900; i++) {
    const t = i * dt;
    stepCar(
      car,
      { throttle: true, steer: t < 2.5 ? 1 : t < 5 ? -1 : 1, brake: i < 24 },
      dt,
      road,
    );
    score.update(car, dt);
    assert.equal(
      score.lastBank,
      0,
      "transitions must not drop the active chain",
    );
    const angle = wrapAngle(car.yaw - Math.atan2(car.vx, car.vz));
    if (car.drifting) {
      if (angle > 0) positive += dt;
      else negative += dt;
    }
    peak = Math.max(peak, car.slip);
  }
  assert(positive > 2 && negative > 1);
  assert(peak < 0.8 && car.speed > 15);
  assert(score.chain > 500 && score.multiplier > 1);
  for (let i = 0; i < 360; i++) {
    stepCar(car, { steer: 0 }, dt, road);
    score.update(car, dt);
  }
  assert(car.slip < 0.04 && Math.abs(car.yawRate) < 0.1);
  assert(score.total > 500 && score.chain === 0);
});
test("self-alignment is bounded and inactive at rest or in reverse", () => {
  const parked = createCarState(),
    reverse = moving(-6);
  stepCar(parked, { steer: 1 }, dt, road);
  stepCar(reverse, { steer: 1 }, dt, road);
  assert.equal(parked.steerAssist, 0);
  assert.equal(reverse.steerAssist, 0);
  const car = moving(20);
  for (let i = 0; i < 1200; i++) {
    stepCar(
      car,
      { throttle: true, steer: Math.sin(i / 90), brake: i % 360 < 24 },
      dt,
      road,
    );
    assert(Math.abs(car.steerAngle) <= 0.62);
    assert(Number.isFinite(car.steerAssist));
  }
});
