const clamp = (value, low, high) => Math.max(low, Math.min(high, value));
export const IDLE_RPM = 900;
export const REDLINE_RPM = 7500;
export const WHEEL_RADIUS = 0.37;
export const GEAR_RATIOS = Object.freeze([0, 3.35, 2.15, 1.56, 1.2, 1, 0.82]);
const ratios = GEAR_RATIOS;
const wheelFactor = (60 * 5.2) / (2 * Math.PI * WHEEL_RADIUS);
export const initialEngineState = () => ({
  gear: 0,
  rpm: IDLE_RPM,
  load: 0,
  shiftRemaining: 0,
});
export function updateEngine(state, car, input, dt) {
  if (dt <= 0) return;
  state.shiftRemaining = Math.max(0, state.shiftRemaining - dt);
  const forward = car.vx * Math.sin(car.yaw) + car.vz * Math.cos(car.yaw);
  const throttle = clamp(car.throttle ?? (Number(input.throttle) || 0), 0, 1);
  const reversing =
    (input.reverse && forward < 0.5) ||
    (state.gear === -1 && forward < -0.5 && !input.throttle);
  if (car.burnoutActive) state.gear = 1;
  else if (reversing) state.gear = -1;
  else if (car.speed < 0.8 && !input.throttle && !input.reverse) state.gear = 0;
  else {
    if (state.gear <= 0) state.gear = 1;
    if (!car.burnoutActive && state.shiftRemaining === 0 && forward > 0) {
      const rpm = forward * wheelFactor * ratios[state.gear];
      if (
        rpm > 6500 &&
        state.gear < 6 &&
        !(car.slip > 0.12 && throttle > 0.3 && !input.reverse)
      ) {
        state.gear++;
        state.shiftRemaining = 0.3;
      } else if (rpm < 2600 && state.gear > 1) {
        state.gear--;
        state.shiftRemaining = 0.3;
      }
    }
  }
  const ratio = state.gear < 0 ? 3.2 : ratios[state.gear],
    rolling =
      (Number.isFinite(car.rearWheelSpeed)
        ? Math.abs(car.rearWheelSpeed) * WHEEL_RADIUS
        : Math.abs(forward)) *
      wheelFactor *
      ratio,
    launching = car.speed < 4 ? IDLE_RPM + 1200 * throttle : IDLE_RPM,
    target = clamp(Math.max(rolling, launching), IDLE_RPM, REDLINE_RPM),
    load =
      (input.reverse ? (state.gear < 0 ? 0.7 : 0.05) : 0.08 + throttle * 0.92) *
      (state.shiftRemaining > 0 ? 0.45 : 1);
  state.rpm += (target - state.rpm) * (1 - Math.exp(-12 * dt));
  state.load += (load - state.load) * (1 - Math.exp(-12 * dt));
}
// Wheel torque uses the same gearing/RPM model as the instruments and audio.
export function engineDriveForce(state, wheelSpeed, throttle, reverse) {
  const surfaceSpeed = wheelSpeed * WHEEL_RADIUS;
  if (reverse > 0)
    return -4200 * reverse * clamp(1 - Math.max(0, -surfaceSpeed) / 9, 0, 1);
  if (throttle <= 0 || state.gear <= 0) return 0;
  const ratio = ratios[state.gear],
    rpm = Math.abs(surfaceSpeed) * wheelFactor * ratio,
    limiter = clamp((REDLINE_RPM - rpm) / 500, 0, 1),
    torqueCurve =
      0.8 + 0.2 * Math.sin(Math.PI * clamp(rpm / REDLINE_RPM, 0, 1));
  return (
    ((11000 * ratio) / ratios[1]) *
    throttle *
    torqueCurve *
    limiter *
    (state.shiftRemaining > 0 ? 0.8 : 1)
  );
}
