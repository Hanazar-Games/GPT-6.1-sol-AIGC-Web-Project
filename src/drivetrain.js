import { clamp } from "./physics.js";
export const IDLE_RPM = 900;
export const REDLINE_RPM = 7500;
const ratios = [0, 3.35, 2.15, 1.56, 1.2, 1, 0.82];
const wheelFactor = (60 * 5.2) / (2 * Math.PI * 0.37);
// Shared instrument/audio telemetry. Shift hysteresis keeps gear and pitch stable
// near a speed boundary; lateral drift speed cannot falsely raise engine RPM.
export class Drivetrain {
  constructor() {
    this.reset();
  }
  reset() {
    this.gear = 0;
    this.rpm = IDLE_RPM;
    this.load = 0;
    this.shiftRemaining = 0;
  }
  update(car, input, dt) {
    if (dt <= 0) return;
    this.shiftRemaining = Math.max(0, this.shiftRemaining - dt);
    const forward = car.vx * Math.sin(car.yaw) + car.vz * Math.cos(car.yaw);
    const reversing =
      (input.reverse && forward < 0.5) ||
      (this.gear === -1 && forward < -0.5 && !input.throttle);
    if (reversing) this.gear = -1;
    else if (car.speed < 0.8 && !input.throttle && !input.reverse)
      this.gear = 0;
    else {
      if (this.gear <= 0) this.gear = 1;
      if (this.shiftRemaining === 0 && forward > 0) {
        const rpm = forward * wheelFactor * ratios[this.gear];
        if (rpm > 6500 && this.gear < 6) {
          this.gear++;
          this.shiftRemaining = 0.3;
        } else if (rpm < 2600 && this.gear > 1) {
          this.gear--;
          this.shiftRemaining = 0.3;
        }
      }
    }
    const ratio = this.gear < 0 ? 3.2 : ratios[this.gear],
      rolling =
        (this.gear < 0 ? Math.max(0, -forward) : Math.max(0, forward)) *
        wheelFactor *
        ratio,
      launching = input.throttle && car.speed < 4 ? 2100 : IDLE_RPM,
      target = clamp(Math.max(rolling, launching), IDLE_RPM, REDLINE_RPM),
      load =
        (input.reverse
          ? this.gear < 0
            ? 0.7
            : 0.05
          : input.throttle
            ? 1
            : 0.08) * (this.shiftRemaining > 0 ? 0.45 : 1);
    this.rpm += (target - this.rpm) * (1 - Math.exp(-12 * dt));
    this.load += (load - this.load) * (1 - Math.exp(-12 * dt));
  }
}
