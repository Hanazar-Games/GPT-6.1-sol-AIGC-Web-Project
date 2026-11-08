import test from "node:test";
import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { createEnvironment } from "./support/environment.js";
import { DriverProfile, PROFILE_KEY } from "../src/profile.js";
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
const env = createEnvironment({
  stored: {
    [PROFILE_KEY]: JSON.stringify({
      version: 1,
      preferences: { handling: "wide" },
    }),
  },
});
await import(appURL);
const state = () => window.__DRIFT__.state;
const select = (id) =>
  env.buttons.find((b) => b.dataset.handling === id).click();
test("garage exposes the saved setup and selectors remain keyboard accessible and persistent", () => {
  assert.equal(state().handling, "wide");
  assert(env.nodes.get("handling-label").textContent.includes("大角度"));
  env.click("handling-shortcut");
  assert(!env.nodes.get("handling-options").classList.contains("hidden"));
  env.key("Tab");
  assert.equal(env.document.activeElement.dataset.handling, "steady");
  select("steady");
  assert.equal(state().handling, "steady");
  assert.equal(new DriverProfile(env.storage).preferences.handling, "steady");
  assert.equal(
    env.buttons.find((b) => b.dataset.handling === "steady")["aria-pressed"],
    "true",
  );
  env.key("Escape");
  env.click("help");
  assert(
    env.nodes.get("handling-options").classList.contains("hidden"),
    "settings controls must not leak into help dialogs",
  );
  env.key("Escape");
});
test("changing setup during a drive pauses time and preserves the car until resuming", () => {
  env.click("start");
  env.key("KeyW");
  for (let i = 0; i < 30; i++) env.tick(0.05);
  env.click("quality");
  assert(state().paused);
  const before = state();
  select("wide");
  env.tick(3);
  assert.equal(state().elapsed, before.elapsed);
  assert.deepEqual(state().car, before.car);
  assert(env.nodes.get("session-mode").textContent.includes("大角度"));
  env.key("Escape");
  assert(!state().paused);
  env.tick(0.1);
  assert(state().elapsed > before.elapsed);
  assert(
    state().car.throttle < before.car.throttle,
    "settings must release held pedals",
  );
  env.key("Escape");
  env.click("return-menu");
  env.click("return-menu");
});
test("driving hints respond to handbrake use and reset without stale advice", () => {
  env.click("start");
  env.key("KeyW");
  for (let i = 0; i < 40; i++) env.tick(0.05);
  env.key("Space");
  env.tick(0.1);
  assert(env.nodes.get("driving-hint").textContent.includes("松开手刹"));
  env.click("touch-reset");
  assert(env.nodes.get("driving-hint").textContent.includes("短按手刹"));
  env.key("Escape");
  env.click("return-menu");
  env.click("return-menu");
});
test("settings return to the original pause screen and cannot dismiss final results", () => {
  env.click("start");
  env.tick(0.2);
  env.key("Escape");
  const elapsed = state().elapsed;
  env.click("quality");
  env.click("quality");
  select("balanced");
  env.tick(2);
  assert.equal(state().elapsed, elapsed);
  env.key("Escape");
  assert(state().paused);
  assert(
    !env.nodes.get("overlay").classList.contains("hidden"),
    "closing settings must restore the pause screen",
  );
  assert(env.nodes.get("dialog-body").innerHTML.includes("结束驾驶"));
  env.click("dialog-action");
  assert(!state().paused);
  env.tick(0.1);
  assert(state().elapsed > elapsed);
  env.key("Escape");
  env.click("return-menu");
  assert(env.nodes.get("quality").disabled);
  const result = env.nodes.get("dialog-body").innerHTML;
  env.click("quality");
  assert.equal(env.nodes.get("dialog-body").innerHTML, result);
  env.click("return-menu");
  assert(!env.nodes.get("quality").disabled);
});
