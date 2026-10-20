export const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
export const wrapAngle = (a) => Math.atan2(Math.sin(a), Math.cos(a));
export function createCarState(x = 0, z = 0, yaw = 0) {
  return {
    x,
    z,
    yaw,
    vx: 0,
    vz: 0,
    steer: 0,
    speed: 0,
    slip: 0,
    drifting: false,
    collisionCooldown: 0,
  };
}
// Arcade rear-wheel-drive model. Velocities are world-space metres per second.
export function stepCar(s, input, dt, road) {
  const forwardX = Math.sin(s.yaw),
    forwardZ = Math.cos(s.yaw);
  let longitudinal = s.vx * forwardX + s.vz * forwardZ;
  let lateral = s.vx * forwardZ - s.vz * forwardX;
  s.steer += (input.steer - s.steer) * (1 - Math.exp(-9 * dt));
  const offroad = road.distance > road.halfWidth;
  const handbrake = input.brake && Math.abs(longitudinal) > 5;
  let drive = input.throttle ? 13.5 : 0;
  if (input.reverse) drive = longitudinal > 1 ? -24 : -7;
  if (handbrake) drive -= Math.sign(longitudinal) * 7;
  drive -= longitudinal * (0.075 + Math.abs(longitudinal) * 0.0038);
  if (offroad) drive -= longitudinal * 0.95;
  longitudinal = clamp(longitudinal + drive * dt, -9, 55);
  const yawRate =
    ((s.steer * longitudinal) / (14 + Math.abs(longitudinal) * 0.16)) *
    (handbrake ? 1.35 : 1);
  s.yaw = wrapAngle(s.yaw + yawRate * dt);
  // Keep momentum through the turn; handbrake deliberately releases rear grip.
  const grip = handbrake
    ? 0.9
    : input.throttle && Math.abs(s.steer) > 0.25 && Math.abs(longitudinal) > 15
      ? 2.8
      : 7.5;
  lateral *= Math.exp(-grip * dt);
  s.vx = forwardX * longitudinal + forwardZ * lateral;
  s.vz = forwardZ * longitudinal - forwardX * lateral;
  s.x += s.vx * dt;
  s.z += s.vz * dt;
  s.speed = Math.hypot(s.vx, s.vz);
  s.slip = Math.abs(wrapAngle(Math.atan2(s.vx, s.vz) - s.yaw));
  s.drifting =
    s.speed > 9 &&
    longitudinal > 0 &&
    s.slip > 0.13 &&
    s.slip < 1.4 &&
    !offroad;
  s.collisionCooldown = Math.max(0, s.collisionCooldown - dt);
}
export function resolveBarrier(s, nearest, halfWidth) {
  if (nearest.distance < halfWidth + 2.8) return false;
  const dx = s.x - nearest.x,
    dz = s.z - nearest.z;
  const d = Math.hypot(dx, dz) || 1;
  s.x = nearest.x + (dx / d) * (halfWidth + 2.6);
  s.z = nearest.z + (dz / d) * (halfWidth + 2.6);
  const outward = (s.vx * dx) / d + (s.vz * dz) / d;
  if (outward > 0) {
    s.vx -= (1.35 * outward * dx) / d;
    s.vz -= (1.35 * outward * dz) / d;
  }
  s.vx *= 0.65;
  s.vz *= 0.65;
  const hit = s.collisionCooldown === 0;
  s.collisionCooldown = 0.65;
  return hit;
}
export class DriftScore {
  constructor() {
    this.total = 0;
    this.chain = 0;
    this.multiplier = 1;
    this.driftTime = 0;
    this.grace = 0;
    this.lastBank = 0;
  }
  update(car, dt) {
    this.lastBank = 0;
    if (car.drifting) {
      this.driftTime += dt;
      this.multiplier = Math.min(5, 1 + Math.floor(this.driftTime / 2) * 0.5);
      this.chain +=
        car.speed * Math.min(car.slip, 1) * 30 * this.multiplier * dt;
      this.grace = 1.6;
    } else if (this.chain > 0) {
      this.grace -= dt;
      if (this.grace <= 0) this.bank();
    }
  }
  bank() {
    this.lastBank = Math.floor(this.chain);
    this.total += this.lastBank;
    this.reset();
    return this.lastBank;
  }
  reset() {
    this.chain = 0;
    this.multiplier = 1;
    this.driftTime = 0;
    this.grace = 0;
  }
}
