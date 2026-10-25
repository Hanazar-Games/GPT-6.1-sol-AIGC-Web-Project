import {
  WHEEL_RADIUS,
  initialEngineState,
  updateEngine,
  engineDriveForce,
} from "./powertrain.js";
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
  wheelRadius: WHEEL_RADIUS,
  rearWheelInertia: 18,
  longitudinalStiffness: 48000,
  steeringRate: 3.8,
  driftTargetRate: 1.8,
});
const wheelbase = CAR_SPEC.frontAxle + CAR_SPEC.rearAxle;
const weight = CAR_SPEC.mass * CAR_SPEC.gravity;
const frontStaticLoad = (weight * CAR_SPEC.rearAxle) / wheelbase;
const pedal = (value) =>
  value === true ? 1 : Number.isFinite(value) ? clamp(value, 0, 1) : 0;
const smooth = (value) => {
  const t = clamp(value, 0, 1);
  return t * t * (3 - 2 * t);
};
export function createCarState(x = 0, z = 0, yaw = 0) {
  return {
    ...initialEngineState(),
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
    steerAssist: 0,
    driftControl: 0,
    driftTarget: 0,
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
    rearWheelSpeed: 0,
    wheelInitialized: false,
    rearSlipRatio: 0,
    rearGrip: 1,
    tireSlipSpeed: 0,
    tireSmoke: 0,
    burnoutActive: false,
    burningOut: false,
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
  if (!s.wheelInitialized) {
    s.rearWheelSpeed = longitudinal / WHEEL_RADIUS;
    s.wheelInitialized = true;
  }
  const rawThrottle = pedal(input.throttle),
    rawReverse = pedal(input.reverse),
    burnoutRequested = !!input.burnout || (rawThrottle > 0 && rawReverse > 0);
  s.burnoutActive =
    burnoutRequested && s.speed < 3.5 && longitudinal > -1 && !input.brake;
  const throttle = s.burnoutActive ? 1 : input.burnout ? 0 : rawThrottle,
    reverse = s.burnoutActive ? 0 : input.burnout ? 1 : rawReverse;
  s.throttle +=
    (throttle - s.throttle) *
    (1 - Math.exp(-(throttle > s.throttle ? 7 : 14) * dt));
  s.serviceBrake +=
    ((longitudinal > 1 ? reverse : 0) - s.serviceBrake) *
    (1 - Math.exp(-16 * dt));
  s.handbrake +=
    (pedal(input.brake) - s.handbrake) *
    (1 - Math.exp(-(input.brake ? 18 : 9) * dt));
  const previousSteerAngle = s.steerAngle;
  const requestedSteer = clamp(input.steer || 0, -1, 1),
    countersteering = requestedSteer * s.steer < 0;
  s.steer +=
    (requestedSteer - s.steer) *
    (1 - Math.exp(-(countersteering ? 18 : 11) * dt));
  const sideslip = Math.atan2(-lateral, Math.max(0.1, longitudinal)),
    sliding =
      smooth((Math.abs(sideslip) - 0.04) / 0.24) *
      smooth((longitudinal - 4) / 6),
    intoSlide = s.steer * sideslip > 0,
    authority = intoSlide ? 1 - sliding * 0.4 : 1,
    steeringRange =
      (0.5 / (1 + Math.abs(longitudinal) / 30)) * (1 - sliding) +
      0.42 * sliding,
    slipRate =
      s.yawRate -
      (longitudinal * s.lateralAccel - lateral * s.longitudinalAccel) /
        Math.max(16, s.speed * s.speed);
  // A keyboard supplies direction, rather than steering-wheel torque. Model a
  // bounded self-aligning rack and quicker deliberate countersteer; all chassis
  // motion still comes from contact-patch forces, never a direct yaw correction.
  s.steerAssist =
    clamp(
      -sideslip *
        (rawThrottle > 0.2
          ? 1.15 + smooth((Math.abs(sideslip) - 0.3) / 0.25) * 0.45
          : 1.25) -
        clamp(slipRate * 0.25, -0.18, 0.18),
      -0.95,
      0.95,
    ) * sliding;
  s.steerAngle = clamp(
    s.steer * steeringRange * authority + s.steerAssist,
    -0.62,
    0.62,
  );
  // Digital keys request a drift direction/angle once the rear has broken away.
  // Neutral steering with power retains the driver's slide; throttle release
  // requests recovery. This controller steers the tires, never rotates velocity.
  const powerSlide =
    s.throttle > 0.15 &&
    rawReverse === 0 &&
    !input.brake &&
    !burnoutRequested &&
    longitudinal > 6;
  const driftEngaged =
    powerSlide && (Math.abs(sideslip) > 0.12 || s.driftControl > 0.4);
  if (driftEngaged) {
    if (Math.abs(requestedSteer) > 0.05)
      s.driftTarget += clamp(
        requestedSteer * 0.46 - s.driftTarget,
        -CAR_SPEC.driftTargetRate * dt,
        CAR_SPEC.driftTargetRate * dt,
      );
    else if (Math.abs(s.driftTarget) < 0.12)
      s.driftTarget =
        Math.sign(sideslip) * clamp(Math.abs(sideslip), 0.2, 0.46);
  }
  s.driftControl +=
    ((driftEngaged ? 1 : 0) - s.driftControl) *
    (1 - Math.exp(-(driftEngaged ? 10 : 6) * dt));
  if (!driftEngaged && s.driftControl < 0.01) s.driftTarget = 0;
  const frontTravel = Math.atan2(
      lateral + CAR_SPEC.frontAxle * s.yawRate,
      Math.max(3, longitudinal),
    ),
    balancedFrontSlip = clamp(
      (s.rearForceY * CAR_SPEC.rearAxle) /
        CAR_SPEC.frontAxle /
        CAR_SPEC.frontStiffness,
      -0.11,
      0.11,
    ),
    desiredSlip = powerSlide
      ? s.driftTarget * (0.45 + 0.55 * smooth((s.throttle - 0.15) / 0.85))
      : 0,
    driftSteering =
      frontTravel +
      balancedFrontSlip +
      (desiredSlip - sideslip) * 0.65 -
      slipRate * 0.23;
  s.steerAngle = clamp(
    s.steerAngle * (1 - s.driftControl) + driftSteering * s.driftControl,
    -0.62,
    0.62,
  );
  // Rack motion stays continuous through assist entry, lift-off and transitions.
  // Limit the actual tire angle after every manual/assisted steering contribution.
  s.steerAngle =
    previousSteerAngle +
    clamp(
      s.steerAngle - previousSteerAngle,
      -CAR_SPEC.steeringRate * dt,
      CAR_SPEC.steeringRate * dt,
    );
  const offroad = road.distance > road.halfWidth;
  updateEngine(s, s, { throttle, reverse }, dt);
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
  const wheelSurface = s.rearWheelSpeed * WHEEL_RADIUS;
  s.rearSlipRatio =
    (wheelSurface - longitudinal) / Math.max(3, Math.abs(longitudinal));
  const spinning =
      s.throttle * smooth((Math.max(0, s.rearSlipRatio) - 0.025) / 0.1),
    gripTarget = 1 - spinning * 0.55;
  s.rearGrip +=
    (gripTarget - s.rearGrip) *
    (1 - Math.exp(-(gripTarget < s.rearGrip ? 16 : 4) * dt));
  const surface = offroad ? 0.55 : 1,
    frontLimit = s.frontLoad * CAR_SPEC.frontFriction * surface,
    rearLimit = s.rearLoad * CAR_SPEC.rearFriction * surface,
    frontPeak =
      frontLimit *
      (1 - 0.12 * clamp((Math.abs(s.frontSlip) - 0.12) / 0.5, 0, 1)),
    rearPeak =
      rearLimit *
      s.rearGrip *
      (1 - 0.16 * clamp((Math.abs(s.rearSlip) - 0.12) / 0.5, 0, 1));
  let motorForce = engineDriveForce(
    s,
    s.rearWheelSpeed,
    s.throttle,
    reverse > 0 && longitudinal <= 1 ? reverse : 0,
  );
  if (reverse > 0 && longitudinal > 1) motorForce = 0;
  let frontX = 0,
    frontY =
      frontPeak *
      Math.tanh((CAR_SPEC.frontStiffness * s.frontSlip) / frontPeak),
    rearX = CAR_SPEC.longitudinalStiffness * s.rearSlipRatio,
    rearY =
      rearPeak * Math.tanh((CAR_SPEC.rearStiffness * s.rearSlip) / rearPeak);
  if (reverse > 0) {
    if (longitudinal > 1) {
      frontX = -15500 * 0.65 * s.serviceBrake;
    }
  }
  if (s.burnoutActive) frontX = -frontLimit * Math.tanh(longitudinal / 0.08);
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
  const brakeTorque =
      s.handbrake * 6500 + s.serviceBrake * 15500 * 0.35 * WHEEL_RADIUS,
    wheelTorque = (motorForce - rearX) * WHEEL_RADIUS - s.rearWheelSpeed * 1.2,
    unbrakedWheel =
      s.rearWheelSpeed + (wheelTorque / CAR_SPEC.rearWheelInertia) * dt;
  s.rearWheelSpeed =
    Math.sign(unbrakedWheel) *
    Math.max(
      0,
      Math.abs(unbrakedWheel) - (brakeTorque / CAR_SPEC.rearWheelInertia) * dt,
    );
  const parked = input.brake && Math.hypot(longitudinal, lateral) < 0.25;
  if (parked) {
    frontX = 0;
    frontY = 0;
    rearX = 0;
    rearY = 0;
    s.rearWheelSpeed = 0;
  }
  // Static front-brake hold: balance available rear traction without pinning a
  // moving chassis. Rear wheels remain free to rotate and heat the contact patch.
  if (s.burnoutActive && Math.hypot(longitudinal, lateral) < 0.25) {
    const hold = Math.min(
      1,
      frontLimit / Math.max(1, Math.hypot(rearX, rearY)),
    );
    frontX = (-rearX * cos - rearY * sin) * hold;
    frontY = (rearX * sin - rearY * cos) * hold;
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
    (s.burnoutActive &&
      Math.hypot(s.vx, s.vz) < 0.25 &&
      Math.hypot(rearX, rearY) <= frontLimit) ||
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
  s.tireSlipSpeed = Math.hypot(
    s.rearWheelSpeed * WHEEL_RADIUS - longitudinal,
    rearSide,
  );
  s.tireSmoke = clamp((s.tireSlipSpeed - 1.5) / 12, 0, 1) * (offroad ? 0.3 : 1);
  s.burningOut =
    s.burnoutActive && s.rearWheelSpeed * WHEEL_RADIUS - longitudinal > 3;
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
