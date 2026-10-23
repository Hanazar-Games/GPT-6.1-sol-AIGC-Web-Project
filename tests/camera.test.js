import test from "node:test";
import assert from "node:assert/strict";
import { drivingCameraHeading } from "../src/camera.js";
import { wrapAngle } from "../src/physics.js";
function car(yaw, travel, speed = 20) {
  return {
    yaw,
    vx: Math.sin(travel) * speed,
    vz: Math.cos(travel) * speed,
    speed,
  };
}
test("chase view follows part of the travel direction while hood view stays attached", () => {
  const sliding = car(0.5, 0);
  assert(
    drivingCameraHeading(sliding, 0) > 0 &&
      drivingCameraHeading(sliding, 0) < 0.5,
  );
  assert.equal(drivingCameraHeading(sliding, 2), sliding.yaw);
  assert.equal(drivingCameraHeading(car(0.5, 0.5), 0), 0.5);
});
test("camera takes the short angular path and cannot flip during reverse or low-speed motion", () => {
  const crossing = car(Math.PI - 0.05, -Math.PI + 0.05);
  assert(
    Math.abs(wrapAngle(drivingCameraHeading(crossing, 0) - crossing.yaw)) < 0.1,
  );
  const reverse = car(0.3, 0.3 + Math.PI),
    slow = car(0.3, 0, 2);
  assert.equal(drivingCameraHeading(reverse, 0), reverse.yaw);
  assert.equal(drivingCameraHeading(slow, 0), slow.yaw);
});
