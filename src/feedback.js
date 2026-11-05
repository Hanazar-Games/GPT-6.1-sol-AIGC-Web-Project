import { clamp, wrapAngle } from "./physics.js";

export function drivingFeedback(car, offroad = false) {
  const forward = car.vx * Math.sin(car.yaw) + car.vz * Math.cos(car.yaw),
    angle =
      car.speed >= 3 && forward > 1
        ? (wrapAngle(car.yaw - Math.atan2(car.vx, car.vz)) * 180) / Math.PI
        : 0,
    degrees = Math.round(Math.abs(angle)),
    throttle = clamp(car.throttle, 0, 1),
    brake = car.burnoutActive
      ? 1
      : clamp(Math.max(car.serviceBrake, car.handbrake), 0, 1);
  return {
    angle:
      degrees > 0
        ? `${angle > 0 ? "L" : "R"} ${String(degrees).padStart(2, "0")}°`
        : "ANGLE 00°",
    throttle,
    brake,
    status: car.burningOut
      ? "BURNOUT"
      : offroad
        ? "OFF ROAD"
        : brake > 0.15
          ? "BRAKING"
          : car.speed > 3 && throttle < 0.12
            ? car.drifting
              ? "RECOVER"
              : "COAST"
            : car.drifting
              ? "SLIDING"
              : "GRIP",
  };
}
