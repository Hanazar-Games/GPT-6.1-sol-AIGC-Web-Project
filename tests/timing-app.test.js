import test from "node:test";
import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { createEnvironment } from "./support/environment.js";
import { LapTracker } from "../src/laps.js";
const appURL = new URL("../src/main.js", import.meta.url).href;
registerHooks({
  resolve(specifier, context, next) {
    if (specifier.endsWith(".css"))
      return {
        url: "data:text/javascript,export default {}",
        shortCircuit: true,
      };
    if (specifier === "three" && context.parentURL === appURL)
      return {
        url: new URL("./support/renderer.js", import.meta.url).href,
        shortCircuit: true,
      };
    return next(specifier, context);
  },
});
const observed = [],
  original = LapTracker.prototype.observe;
LapTracker.prototype.observe = function (progress, elapsed) {
  observed.push(elapsed);
  return original.call(this, progress, elapsed);
};
const env = createEnvironment();
await import(appURL);
const state = () => window.__DRIFT__.state;
test("lap observations follow individual physics ticks at low and high display rates", () => {
  for (const fps of [4, 30, 60, 144]) {
    env.click("start");
    observed.length = 0;
    for (let i = 0; i < fps * 3; i++) env.tick(1 / fps);
    assert(observed.length >= 359 && observed.length <= 360);
    for (let i = 0; i < observed.length; i++)
      assert(
        Math.abs(observed[i] - (i + 1) / 120) < 1e-8,
        `${fps} Hz: lap timing must not quantize every tick to the frame end`,
      );
    assert(Math.abs(state().elapsed - 3) < 1e-8);
  }
});
test("stalls keep wall time while bounded catch-up observations remain ordered", () => {
  env.click("start");
  observed.length = 0;
  env.tick(1);
  assert.equal(state().elapsed, 1);
  assert(observed.length >= 29 && observed.length <= 30);
  assert(Math.abs(observed[0] - (0.75 + 1 / 120)) < 1e-8);
  assert(observed.at(-1) <= 1 + 1e-8);
  for (let i = 1; i < observed.length; i++)
    assert(Math.abs(observed[i] - observed[i - 1] - 1 / 120) < 1e-8);
  env.key("Escape");
  const count = observed.length;
  env.tick(5);
  assert.equal(observed.length, count);
  env.click("dialog-action");
  env.tick(0.1);
  assert(
    Math.abs(observed[count] - (1 + 1 / 120)) < 1e-8,
    "paused wall time must never leak into lap observations",
  );
});
