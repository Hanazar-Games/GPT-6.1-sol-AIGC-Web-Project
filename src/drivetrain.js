import { initialEngineState, updateEngine } from "./powertrain.js";
export { IDLE_RPM, REDLINE_RPM } from "./powertrain.js";
export class Drivetrain {
  constructor() {
    this.reset();
  }
  reset() {
    Object.assign(this, initialEngineState());
  }
  update(car, input, dt) {
    if (Number.isFinite(car.rearWheelSpeed) && Number.isFinite(car.rpm)) {
      for (const key of ["gear", "rpm", "load", "shiftRemaining"])
        this[key] = car[key];
    } else updateEngine(this, car, input, dt);
  }
}
