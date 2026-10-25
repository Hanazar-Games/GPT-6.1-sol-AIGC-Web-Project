import test from "node:test";
import assert from "node:assert/strict";
import { Drivetrain, IDLE_RPM, REDLINE_RPM } from "../src/drivetrain.js";
import { createCarState, stepCar } from "../src/physics.js";
const car = (forward, lateral = 0) => ({
  vx: lateral,
  vz: forward,
  yaw: 0,
  speed: Math.hypot(forward, lateral),
});
const run = (engine, vehicle, input, seconds = 1) => {
  for (let i = 0; i < Math.round(seconds * 120); i++)
    engine.update(vehicle, input, 1 / 120);
};
test("automatic gears rise with actual acceleration and recover cleanly to neutral and reverse", () => {
  const engine = new Drivetrain(),
    vehicle = createCarState(),
    input = { throttle: true, steer: 0 },
    gears = new Set();
  let shifts = 0,
    lastGear = 0;
  // Torque now reaches the chassis through wheel slip and actual gear ratios.
  // Include the slower high-gear acceleration, rather than assuming constant force.
  for (let i = 0; i < 90 * 120; i++) {
    stepCar(vehicle, input, 1 / 120, { distance: 0, halfWidth: 10 });
    engine.update(vehicle, input, 1 / 120);
    assert(engine.rpm >= IDLE_RPM && engine.rpm <= REDLINE_RPM);
    gears.add(engine.gear);
    if (engine.gear !== lastGear) {
      shifts++;
      lastGear = engine.gear;
    }
  }
  assert(gears.has(1) && gears.has(6));
  assert.equal(shifts, 6, "steady acceleration must not hunt between gears");
  run(engine, car(0), {});
  assert.equal(engine.gear, 0);
  assert(Math.abs(engine.rpm - IDLE_RPM) < 1);
  run(engine, car(-8), { reverse: true });
  assert.equal(engine.gear, -1);
  assert(engine.rpm > 2000);
  run(engine, car(-6), {});
  assert.equal(
    engine.gear,
    -1,
    "coasting in reverse retains its selected gear",
  );
  run(engine, car(3), { throttle: true });
  assert.equal(engine.gear, 1);
});
test("upshifts lower RPM and hysteresis prevents rapid gear changes at the boundary", () => {
  const engine = new Drivetrain();
  run(engine, car(14), { throttle: true });
  assert.equal(engine.gear, 1);
  const before = engine.rpm;
  run(engine, car(15), { throttle: true });
  assert.equal(engine.gear, 2);
  assert(engine.rpm < before - 1000);
  for (let i = 0; i < 240; i++) {
    engine.update(car(i % 2 ? 14 : 15), { throttle: true }, 1 / 120);
    assert.equal(engine.gear, 2);
  }
});
test("sideways motion does not inflate RPM and reset clears shift state", () => {
  const straight = new Drivetrain(),
    sliding = new Drivetrain();
  run(straight, car(20), { throttle: true });
  run(sliding, car(20, 30), { throttle: true });
  assert.equal(sliding.gear, straight.gear);
  assert.equal(sliding.rpm, straight.rpm);
  sliding.reset();
  assert.equal(sliding.gear, 0);
  assert.equal(sliding.rpm, IDLE_RPM);
  assert.equal(sliding.shiftRemaining, 0);
});
test("linked drift does not upshift on a brief straightening until wheel torque benefits", async () => {
  const { initialEngineState, updateEngine } = await import(
    "../src/powertrain.js"
  );
  const state = { ...initialEngineState(), gear: 2, rpm: 6900 };
  const vehicle = {
    ...car(23.5),
    throttle: 1,
    slip: 0.05,
    driftControl: 1,
    rearWheelSpeed: 24 / 0.37,
  };
  updateEngine(state, vehicle, { throttle: true }, 1 / 120);
  assert.equal(
    state.gear,
    2,
    "a low sideslip crossing must not cut torque mid-transition",
  );
});
test("redline wheelspin permits a drift upshift when it restores wheel force, with shift torque included", async () => {
  const { initialEngineState, updateEngine, engineDriveForce } = await import(
    "../src/powertrain.js"
  );
  const state = { ...initialEngineState(), gear: 2, rpm: 7200 };
  const vehicle = {
    ...car(22),
    throttle: 1,
    slip: 0.4,
    driftControl: 1,
    rearWheelSpeed: 25.5 / 0.37,
  };
  const before = engineDriveForce(state, vehicle.rearWheelSpeed, 1, 0);
  updateEngine(state, vehicle, { throttle: true }, 1 / 120);
  assert.equal(
    state.gear,
    3,
    "wheel redline must not leave the car trapped in a weak low gear",
  );
  assert(engineDriveForce(state, vehicle.rearWheelSpeed, 1, 0) > before);
  updateEngine(state, vehicle, { throttle: true }, 1 / 120);
  assert.equal(
    state.gear,
    3,
    "shift cooldown must block another immediate gear change",
  );
});
