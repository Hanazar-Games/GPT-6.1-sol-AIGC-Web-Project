import { clamp, wrapAngle } from "./physics.js";

export function drivingFeedback(car, offroad = false) {
  const forward = car.vx * Math.sin(car.yaw) + car.vz * Math.cos(car.yaw),
    angle =
      car.speed >= 3 && forward > 1
        ? (wrapAngle(car.yaw - Math.atan2(car.vx, car.vz)) * 180) / Math.PI
        : 0,
    degrees = Math.round(Math.abs(angle)),
    throttle = clamp(car.gear < 0 ? car.reverseThrottle : car.throttle, 0, 1),
    brake = car.burnoutActive
      ? 1
      : clamp(Math.max(car.serviceBrake, car.handbrake), 0, 1);
  const status = car.burningOut
    ? "BURNOUT"
    : offroad
      ? "OFF ROAD"
      : brake > 0.15
        ? "BRAKING"
        : car.gear < 0 && throttle >= 0.12
          ? "REVERSING"
          : forward < -0.5
            ? "REVERSE"
            : car.speed > 3 && throttle < 0.12
              ? car.drifting
                ? "RECOVER"
                : "COAST"
              : car.drifting
                ? "SLIDING"
                : "GRIP";
  const hints = {
    GRIP: "加速后转向，短按手刹起漂",
    SLIDING: "稳住油门，轻调方向保持角度",
    RECOVER: "松开方向，让后轮恢复抓地",
    COAST: "补油加速，准备下一个弯",
    BRAKING:
      car.handbrake > 0.15
        ? car.speed < 3
          ? "松开手刹即可起步"
          : "松开手刹，补油接住侧滑"
        : "控制入弯速度，准备转向",
    BURNOUT: "松开烧胎键，给油起步",
    "OFF ROAD": "回到路面，必要时使用回正",
    REVERSING: "松开刹车键减速，按油门前进",
    REVERSE:
      throttle >= 0.12 ? "保持油门，减速后前进" : "倒车滑行，按油门可前进",
  };
  return {
    angle:
      degrees > 0
        ? `${angle > 0 ? "L" : "R"} ${String(degrees).padStart(2, "0")}°`
        : "ANGLE 00°",
    throttle,
    brake,
    status,
    hint: hints[status],
  };
}
