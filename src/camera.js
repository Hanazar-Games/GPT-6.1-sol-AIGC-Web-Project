import { clamp, wrapAngle } from "./physics.js";
// Keep a readable view of the car and its path while it slides. The hood camera
// stays attached to the body, and reverse driving cannot flip a chase camera.
export function drivingCameraHeading(car, mode) {
  if (mode === 2 || car.speed < 4) return car.yaw;
  const forward = car.vx * Math.sin(car.yaw) + car.vz * Math.cos(car.yaw);
  if (forward < 1) return car.yaw;
  const travel = Math.atan2(car.vx, car.vz),
    offset = clamp(wrapAngle(travel - car.yaw), -0.75, 0.75),
    blend = clamp((car.speed - 4) / 12, 0, 1) * (mode === 1 ? 0.35 : 0.5);
  return car.yaw + offset * blend;
}
