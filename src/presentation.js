import { clamp, wrapAngle } from "./physics.js";
import { WHEEL_RADIUS } from "./powertrain.js";

const fields = [
  "x",
  "z",
  "yaw",
  "vx",
  "vz",
  "speed",
  "roll",
  "pitch",
  "steerAngle",
];
// Keep rendering between the last two completed physics states. Wheel rotation
// advances in physics time as well, including frames with multiple catch-up steps.
export class VehiclePresentation {
  constructor(car) {
    this.previous = {};
    this.current = {};
    this.reset(car);
  }
  reset(car) {
    for (const key of fields) this.current[key] = car[key];
    this.current.frontWheelSpin = 0;
    this.current.rearWheelSpin = 0;
    Object.assign(this.previous, this.current);
  }
  advance(car, dt) {
    const recycled = this.previous;
    this.previous = this.current;
    this.current = recycled;
    for (const key of fields) this.current[key] = car[key];
    const forward = car.vx * Math.sin(car.yaw) + car.vz * Math.cos(car.yaw);
    this.current.frontWheelSpin =
      this.previous.frontWheelSpin + (forward / WHEEL_RADIUS) * dt;
    this.current.rearWheelSpin =
      this.previous.rearWheelSpin + car.rearWheelSpeed * dt;
  }
  sample(alpha, out = {}) {
    const t = Number.isFinite(alpha) ? clamp(alpha, 0, 1) : 1;
    for (const key of fields) {
      const delta =
        key === "yaw"
          ? wrapAngle(this.current[key] - this.previous[key])
          : this.current[key] - this.previous[key];
      out[key] = this.previous[key] + delta * t;
    }
    for (const key of ["frontWheelSpin", "rearWheelSpin"])
      out[key] =
        this.previous[key] + (this.current[key] - this.previous[key]) * t;
    return out;
  }
}
