import test from "node:test";
import assert from "node:assert/strict";
import {
  CAR_SPEC,
  createCarState,
  stepCar,
  wrapAngle,
  clamp,
} from "../src/physics.js";
const road = { distance: 0, halfWidth: 10 },
  dt = 1 / 120;
function drive(car, input, seconds, surface = road, step = dt) {
  for (let i = 0; i < Math.round(seconds / step); i++)
    stepCar(
      car,
      typeof input === "function" ? input(car, i) : input,
      step,
      surface,
    );
  return car;
}
function moving(speed = 20) {
  const car = createCarState();
  car.vz = speed;
  car.speed = Math.abs(speed);
  return car;
}
const energy = (car) =>
  0.5 * CAR_SPEC.mass * (car.vx ** 2 + car.vz ** 2) +
  0.5 * CAR_SPEC.yawInertia * car.yawRate ** 2;
test("stationary steering creates no rotation or energy and yaw momentum survives steering release", () => {
  const parked = drive(createCarState(1, 2, 0.7), { steer: 1 }, 4);
  assert.equal(parked.x, 1);
  assert.equal(parked.z, 2);
  assert.equal(parked.yaw, 0.7);
  assert.equal(energy(parked), 0);
  const car = drive(moving(), { steer: 0.5 }, 0.25),
    previous = car.yawRate,
    heading = car.yaw;
  assert(previous > 0.1);
  stepCar(car, { steer: -1 }, dt, road);
  assert(
    car.yawRate > 0,
    "countersteer cannot instantly reverse chassis angular momentum",
  );
  assert(car.yaw > heading);
  assert(Math.abs(car.yawRate - previous) < 0.15);
});
test("acceleration loads the rear axle and braking shifts load forward without changing total weight", () => {
  const car = createCarState(),
    frontAtRest = car.frontLoad;
  drive(car, { throttle: true }, 3);
  assert(car.frontLoad < frontAtRest);
  assert(car.longitudinalAccel > 0);
  drive(car, { reverse: true }, 0.5);
  assert(car.frontLoad > frontAtRest);
  assert(car.longitudinalAccel < 0);
  assert(
    Math.abs(car.frontLoad + car.rearLoad - CAR_SPEC.mass * CAR_SPEC.gravity) <
      1e-8,
  );
  assert(car.frontLoad > 0 && car.rearLoad > 0);
});
test("combined tire forces stay within axle adhesion budgets on asphalt and off road", () => {
  for (const surface of [road, { distance: 12, halfWidth: 10 }]) {
    const car = moving(23),
      grip = surface.distance > surface.halfWidth ? 0.55 : 1;
    drive(
      car,
      (state, i) => {
        if (i > 0) {
          assert(
            Math.hypot(state.frontForceX, state.frontForceY) <=
              state.frontLoad * CAR_SPEC.frontFriction * grip + 1e-7,
          );
          assert(
            Math.hypot(state.rearForceX, state.rearForceY) <=
              state.rearLoad * CAR_SPEC.rearFriction * grip + 1e-7,
          );
        }
        return {
          throttle: i % 360 < 240,
          reverse: i % 360 > 300,
          steer: Math.sin(i / 80),
          brake: i % 240 > 190,
        };
      },
      12,
      surface,
    );
    assert(
      Object.values(car).every(
        (value) => typeof value !== "number" || Number.isFinite(value),
      ),
    );
  }
});
test("coasting turns and locked rear wheels cannot add mechanical energy", () => {
  for (const brake of [false, true]) {
    const car = moving(24),
      initial = energy(car);
    drive(
      car,
      (state) => {
        assert(energy(state) <= initial * 1.005);
        return { steer: 0.4, brake };
      },
      6,
    );
    assert(energy(car) < initial * 0.6);
  }
});
test("a short handbrake initiation can be caught with countersteer and throttle release", () => {
  const car = drive(createCarState(), { throttle: true }, 4);
  drive(car, { throttle: true, steer: 0.6, brake: true }, 0.35);
  const holding = { ...car };
  let peak = 0,
    scoredSteps = 0;
  drive(
    car,
    (state) => {
      peak = Math.max(peak, state.slip);
      if (state.drifting) scoredSteps++;
      const angle = wrapAngle(state.yaw - Math.atan2(state.vx, state.vz));
      return { steer: clamp(-angle * 3 - state.yawRate * 0.6, -1, 1) };
    },
    2,
  );
  drive(holding, { throttle: true, steer: 0.6 }, 2);
  assert(
    peak > 0.2 && peak < 0.7,
    "initiation must create a controllable slide",
  );
  assert(scoredSteps > 30);
  assert(car.slip < 0.06 && Math.abs(car.yawRate) < 0.1);
  assert(car.speed > 12, "recovery must preserve useful forward momentum");
  assert(
    holding.slip > car.slip + 0.1 && holding.speed > 12,
    "holding the turn maintains a slide while deliberate recovery straightens it",
  );
});
test("left and right handling mirror each other, including reverse steering", () => {
  const left = moving(),
    right = moving();
  drive(left, { throttle: 0.4, steer: 0.35 }, 2);
  drive(right, { throttle: 0.4, steer: -0.35 }, 2);
  assert(Math.abs(left.x + right.x) < 1e-7);
  assert(Math.abs(left.z - right.z) < 1e-7);
  assert(Math.abs(left.yawRate + right.yawRate) < 1e-7);
  const reverse = drive(moving(-6), { steer: 0.5 }, 0.5);
  assert(reverse.yawRate < 0);
});
test("pedals build and release progressively, and partial throttle remains distinct", () => {
  const full = moving(12),
    partial = moving(12);
  stepCar(full, { throttle: true }, dt, road);
  assert(full.throttle > 0 && full.throttle < 0.1);
  drive(full, { throttle: true }, 0.5);
  drive(partial, { throttle: 0.4 }, 0.5);
  assert(full.rearForceX > partial.rearForceX);
  drive(full, {}, 0.3);
  assert(full.throttle < 0.02);
});
test("tire dynamics remain consistent at 60, 120 and 240 Hz", () => {
  const cars = [1 / 60, 1 / 120, 1 / 240].map((step) =>
    drive(moving(18), { throttle: 0.3, steer: 0.2 }, 4, road, step),
  );
  for (const car of cars.slice(1)) {
    assert(Math.hypot(car.x - cars[0].x, car.z - cars[0].z) < 0.5);
    assert(Math.abs(car.yaw - cars[0].yaw) < 0.03);
  }
});
