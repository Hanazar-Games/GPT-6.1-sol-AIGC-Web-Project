import test from "node:test";
import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { createEnvironment } from "./support/environment.js";
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
const env = createEnvironment();
await import(appURL);
const state = () => window.__DRIFT__.state;
const gas = env.buttons.find((button) => button.dataset.key === "KeyW");
test("removing touch controls releases held fingers without latching the throttle", () => {
  env.click("start");
  env.event(gas, "pointerdown", { pointerId: 1, button: 0 });
  assert(gas.classList.contains("pressed"));
  const coarse = env.media.get("(any-pointer: coarse)");
  coarse.matches = false;
  env.event(coarse, "change");
  assert(env.nodes.get("touch").classList.contains("hidden"));
  assert(!gas.classList.contains("pressed"));
  env.click("touch-reset");
  env.tick(0.1);
  assert.equal(
    state().car.speed,
    0,
    "hidden touch controls must not keep accelerating",
  );
});
test("keyboard and multitouch keep button feedback coherent through cancellation", () => {
  const coarse = env.media.get("(any-pointer: coarse)");
  coarse.matches = true;
  env.event(coarse, "change");
  env.key("ArrowUp");
  assert(gas.classList.contains("pressed"));
  env.event(gas, "pointerdown", { pointerId: 2, button: 0 });
  env.event(gas, "pointerdown", { pointerId: 3, button: 0 });
  env.key("ArrowUp", "keyup");
  assert(gas.classList.contains("pressed"));
  env.event(gas, "pointercancel", { pointerId: 2 });
  assert(gas.classList.contains("pressed"));
  env.event(gas, "lostpointercapture", { pointerId: 3 });
  assert(!gas.classList.contains("pressed"));
  env.key("KeyW");
  coarse.matches = false;
  env.event(coarse, "change");
  env.click("touch-reset");
  env.tick(0.1);
  assert(state().car.speed > 0, "device changes must retain keyboard input");
  env.key("KeyW", "keyup");
  assert(!gas.classList.contains("pressed"));
});
test("failed capture still releases outside the button and secondary clicks cannot accelerate", () => {
  env.click("touch-reset");
  const capture = gas.setPointerCapture;
  let attempts = 0;
  gas.setPointerCapture = () => {
    attempts++;
    throw new Error("Pointer no longer active");
  };
  env.event(gas, "pointerdown", { pointerId: 4, button: 0 });
  assert.equal(attempts, 1);
  assert(gas.classList.contains("pressed"));
  env.windowEvent("pointerup", { pointerId: 4 });
  assert(!gas.classList.contains("pressed"));
  env.tick(0.1);
  assert.equal(state().car.speed, 0);
  env.event(gas, "pointerdown", { pointerId: 5, button: 2 });
  env.tick(0.1);
  assert.equal(state().car.speed, 0);
  assert.equal(attempts, 1, "right click must not capture a driving control");
  gas.setPointerCapture = capture;
});
test("a handbrake tap between frames reaches physics, then releases without sticking", () => {
  env.click("start");
  env.key("KeyW");
  for (let i = 0; i < 30; i++) env.tick(0.1);
  env.key("KeyA");
  env.key("Space");
  env.key("Space", "keyup");
  env.tick(0.05);
  assert(state().car.handbrake > 0.2);
  for (let i = 0; i < 6; i++) env.tick(0.1);
  assert(state().car.handbrake < 0.05);
  const brake = env.buttons.find((button) => button.dataset.key === "Space");
  assert(!brake.classList.contains("pressed"));
  env.event(brake, "pointerdown", { pointerId: 10, button: 0 });
  env.event(brake, "pointercancel", { pointerId: 10 });
  env.tick(0.1);
  assert(
    state().car.handbrake < 0.05,
    "cancelled touches must not apply buffered braking",
  );
  env.key("Escape");
  env.click("return-menu");
  env.click("return-menu");
});
