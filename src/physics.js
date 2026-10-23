export const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
export const wrapAngle = (a) => Math.atan2(Math.sin(a), Math.cos(a));
export const CAR_SPEC = Object.freeze({
  mass: 1250,
  yawInertia: 1900,
  frontAxle: 1.15,
  rearAxle: 1.4,
  cgHeight: 0.52,
  gravity: 9.81,
  frontStiffness: 62000,
  rearStiffness: 68000,
  frontFriction: 1.02,
  rearFriction: 1.12,
});
const wheelbase = CAR_SPEC.frontAxle + CAR_SPEC.rearAxle;
const weight = CAR_SPEC.mass * CAR_SPEC.gravity;
const frontStaticLoad = (weight * CAR_SPEC.rearAxle) / wheelbase;
const pedal = (value) =>
  value === true ? 1 : Number.isFinite(value) ? clamp(value, 0, 1) : 0;
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
    yawRate: 0,
    steerAngle: 0,
    handbrake: 0,
    throttle: 0,
    serviceBrake: 0,
    longitudinalAccel: 0,
    lateralAccel: 0,
    frontLoad: frontStaticLoad,
    rearLoad: weight - frontStaticLoad,
    frontSlip: 0,
    rearSlip: 0,
    frontForceX: 0,
    frontForceY: 0,
    rearForceX: 0,
    rearForceY: 0,
    roll: 0,
    pitch: 0,
  };
}
// Planar rigid-body / two-axle model. SI units throughout; positive body lateral
// velocity and yaw follow the game's existing steering convention.
export function stepCar(s, input, dt, road) {
  if (!Number.isFinite(dt) || dt <= 0) return;
  const count = Math.ceil(dt * 120),
    step = dt / count;
  for (let i = 0; i < count; i++) integrateCar(s, input, step, road);
}
function integrateCar(s, input, dt, road) {
  const forwardX = Math.sin(s.yaw),
    forwardZ = Math.cos(s.yaw);
  const longitudinal = s.vx * forwardX + s.vz * forwardZ;
  const lateral = s.vx * forwardZ - s.vz * forwardX;
  s.steer +=
    (clamp(input.steer || 0, -1, 1) - s.steer) * (1 - Math.exp(-9 * dt));
  s.steerAngle = s.steer * (0.5 / (1 + Math.abs(longitudinal) / 30));
  const offroad = road.distance > road.halfWidth;
  const throttle = pedal(input.throttle),
    reverse = pedal(input.reverse);
  s.throttle +=
    (throttle - s.throttle) *
    (1 - Math.exp(-(throttle > s.throttle ? 7 : 14) * dt));
  s.serviceBrake +=
    ((longitudinal > 1 ? reverse : 0) - s.serviceBrake) *
    (1 - Math.exp(-16 * dt));
  s.handbrake +=
    (pedal(input.brake) - s.handbrake) *
    (1 - Math.exp(-(input.brake ? 18 : 9) * dt));
  const transfer =
    (CAR_SPEC.mass * s.longitudinalAccel * CAR_SPEC.cgHeight) / wheelbase;
  s.frontLoad = clamp(frontStaticLoad - transfer, weight * 0.18, weight * 0.82);
  s.rearLoad = weight - s.frontLoad;
  const cos = Math.cos(s.steerAngle),
    sin = Math.sin(s.steerAngle),
    frontLateral = lateral + CAR_SPEC.frontAxle * s.yawRate,
    frontLong = longitudinal * cos + frontLateral * sin,
    frontSide = frontLateral * cos - longitudinal * sin,
    rearSide = lateral - CAR_SPEC.rearAxle * s.yawRate;
  // A low-speed denominator regularizes standstill/reverse without adding
  // artificial steering rotation or energy to a stationary car.
  s.frontSlip = Math.atan2(-frontSide, Math.max(3, Math.abs(frontLong)));
  s.rearSlip = Math.atan2(-rearSide, Math.max(3, Math.abs(longitudinal)));
  const surface = offroad ? 0.55 : 1,
    frontLimit = s.frontLoad * CAR_SPEC.frontFriction * surface,
    rearLimit = s.rearLoad * CAR_SPEC.rearFriction * surface,
    frontPeak =
      frontLimit *
      (1 - 0.12 * clamp((Math.abs(s.frontSlip) - 0.12) / 0.5, 0, 1)),
    rearPeak =
      rearLimit * (1 - 0.16 * clamp((Math.abs(s.rearSlip) - 0.12) / 0.5, 0, 1));
  let frontX = 0,
    frontY =
      frontPeak *
      Math.tanh((CAR_SPEC.frontStiffness * s.frontSlip) / frontPeak),
    rearX =
      s.throttle *
      9000 *
      clamp(1 - (Math.max(0, longitudinal) / 64) ** 2, 0, 1),
    rearY =
      rearPeak * Math.tanh((CAR_SPEC.rearStiffness * s.rearSlip) / rearPeak);
  if (reverse > 0) {
    if (longitudinal > 1) {
      frontX = -15500 * 0.65 * s.serviceBrake;
      rearX = -15500 * 0.35 * s.serviceBrake;
    } else
      rearX = -4200 * reverse * clamp(1 - Math.max(0, -longitudinal) / 9, 0, 1);
  }
  // Longitudinal and lateral demands share the same contact-patch budget.
  // Throttle can therefore break rear grip while the front axle keeps steering.
  const frontScale = Math.min(
      1,
      frontLimit / Math.max(1, Math.hypot(frontX, frontY)),
    ),
    rearScale = Math.min(1, rearLimit / Math.max(1, Math.hypot(rearX, rearY)));
  frontX *= frontScale;
  frontY *= frontScale;
  rearX *= rearScale;
  rearY *= rearScale;
  const rearContactSpeed = Math.max(0.2, Math.hypot(longitudinal, rearSide)),
    lockedForce = rearLimit * 0.72;
  rearX +=
    ((-lockedForce * longitudinal) / rearContactSpeed - rearX) * s.handbrake;
  rearY += ((-lockedForce * rearSide) / rearContactSpeed - rearY) * s.handbrake;
  const parked = input.brake && Math.hypot(longitudinal, lateral) < 0.25;
  if (parked) {
    frontX = 0;
    frontY = 0;
    rearX = 0;
    rearY = 0;
  }
  s.frontForceX = frontX;
  s.frontForceY = frontY;
  s.rearForceX = rearX;
  s.rearForceY = rearY;
  const frontBodyX = frontX * cos - frontY * sin,
    frontBodyY = frontX * sin + frontY * cos,
    drag =
      18 +
      0.55 * Math.hypot(longitudinal, lateral) +
      (offroad ? CAR_SPEC.mass * 0.08 : 0),
    rolling =
      weight * (offroad ? 0.075 : 0.015) * Math.tanh(longitudinal / 0.5),
    forceX = frontBodyX + rearX - longitudinal * drag - rolling,
    forceY = frontBodyY + rearY - lateral * drag,
    accelX = forceX / CAR_SPEC.mass,
    accelY = forceY / CAR_SPEC.mass;
  s.longitudinalAccel +=
    (accelX - s.longitudinalAccel) * (1 - Math.exp(-12 * dt));
  s.lateralAccel += (accelY - s.lateralAccel) * (1 - Math.exp(-12 * dt));
  s.vx += (forwardX * accelX + forwardZ * accelY) * dt;
  s.vz += (forwardZ * accelX - forwardX * accelY) * dt;
  s.yawRate +=
    ((CAR_SPEC.frontAxle * frontBodyY - CAR_SPEC.rearAxle * rearY) /
      CAR_SPEC.yawInertia) *
    dt;
  s.yawRate *= Math.exp(-0.15 * dt);
  if (
    parked ||
    (!input.throttle && !input.reverse && Math.hypot(s.vx, s.vz) < 0.04)
  ) {
    s.vx = 0;
    s.vz = 0;
    s.yawRate *= Math.exp(-18 * dt);
  }
  s.yaw = wrapAngle(s.yaw + s.yawRate * dt);
  s.x += s.vx * dt;
  s.z += s.vz * dt;
  s.speed = Math.hypot(s.vx, s.vz);
  s.slip =
    s.speed > 0.1 ? Math.abs(wrapAngle(Math.atan2(s.vx, s.vz) - s.yaw)) : 0;
  s.drifting =
    s.speed > 9 &&
    longitudinal > 0 &&
    s.slip > 0.13 &&
    s.slip < 1.4 &&
    !offroad;
  s.roll +=
    (clamp((s.lateralAccel / CAR_SPEC.gravity) * 0.055, -0.08, 0.08) - s.roll) *
    (1 - Math.exp(-7 * dt));
  s.pitch +=
    (clamp((-s.longitudinalAccel / CAR_SPEC.gravity) * 0.04, -0.05, 0.05) -
      s.pitch) *
    (1 - Math.exp(-7 * dt));
  s.collisionCooldown = Math.max(0, s.collisionCooldown - dt);
}
export function resolveBarrier(s, nearest, halfWidth) {
  const dx = s.x - nearest.x,
    dz = s.z - nearest.z;
  const distance = Math.hypot(dx, dz);
  if (distance < 1e-8) return false;
  const nx = dx / distance,
    nz = dz / distance;
  // Guardrails sit three metres outside the road. Account for the whole rotated
  // coupe, including its nose/tail during a sideways slide, rather than its centre.
  const forwardProjection = Math.abs(
    nx * Math.sin(s.yaw) + nz * Math.cos(s.yaw),
  );
  const sideProjection = Math.abs(nx * Math.cos(s.yaw) - nz * Math.sin(s.yaw));
  const clearance =
    halfWidth + 3 - (2.15 * forwardProjection + 1.05 * sideProjection) - 0.12;
  if (distance <= clearance) return false;
  s.x = nearest.x + nx * (clearance - 0.04);
  s.z = nearest.z + nz * (clearance - 0.04);
  const outward = s.vx * nx + s.vz * nz;
  const hit = outward > 0.1 && s.collisionCooldown === 0;
  if (outward > 0) {
    s.vx -= 1.15 * outward * nx;
    s.vz -= 1.15 * outward * nz;
    // Friction applies once per impact; a car sliding along the rail can recover.
    if (hit) {
      s.vx *= 0.88;
      s.vz *= 0.88;
      s.yawRate *= 0.55;
    }
  }
  s.speed = Math.hypot(s.vx, s.vz);
  s.slip = Math.abs(wrapAngle(Math.atan2(s.vx, s.vz) - s.yaw));
  s.drifting = false;
  s.collisionCooldown = 0.65;
  // Always report physical contact; cooldown only limits impact feedback/friction.
  return true;
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
