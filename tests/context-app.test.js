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
const lose = () => env.event(env.nodes.get("world"), "webglcontextlost");
const restore = () => env.event(env.nodes.get("world"), "webglcontextrestored");
test("garage dialogs stay usable without a graphics context while starting stays blocked", () => {
  env.click("help");
  assert(lose().defaultPrevented);
  assert(env.nodes.get("start").disabled);
  assert(!env.nodes.get("dialog-action").disabled);
  env.click("dialog-action");
  assert(env.nodes.get("overlay").classList.contains("hidden"));
  for (const id of ["records", "quality"]) {
    env.click(id);
    assert(!env.nodes.get("dialog-action").disabled);
    env.click("dialog-action");
    assert(env.nodes.get("overlay").classList.contains("hidden"));
  }
  env.click("start");
  assert(!state().playing);
  restore();
  assert(!env.nodes.get("start").disabled);
});
test("context loss inside driving settings restores a pause screen with a working save-and-exit path", () => {
  env.click("start");
  env.key("KeyW");
  env.tick(0.2);
  env.click("quality");
  const before = state();
  lose();
  assert(state().paused && env.nodes.get("dialog-action").disabled);
  assert(env.nodes.get("dialog-title").textContent.includes("中断"));
  assert.equal(
    env.document.activeElement.id,
    "return-menu",
    "keyboard focus must land on an available exit action",
  );
  assert(env.nodes.get("handling-options").classList.contains("hidden"));
  env.tick(3);
  assert.equal(state().elapsed, before.elapsed);
  assert.deepEqual(state().car, before.car);
  env.click("return-menu");
  assert(
    env.nodes.get("dialog-action").disabled,
    "restarting still requires the graphics context",
  );
  env.click("return-menu");
  assert(!state().playing);
  assert(env.nodes.get("start").disabled);
  env.click("help");
  env.click("dialog-action");
  assert(env.nodes.get("overlay").classList.contains("hidden"));
  restore();
});
test("graphics restoration enables continuation without automatically resuming or retaining held pedals", () => {
  env.click("start");
  env.key("KeyW");
  env.tick(0.2);
  lose();
  const before = state();
  env.tick(4);
  assert.deepEqual(state().car, before.car);
  restore();
  assert(state().paused);
  assert(!env.nodes.get("dialog-action").disabled);
  assert(env.nodes.get("dialog-title").textContent.includes("暂停"));
  env.click("dialog-action");
  env.tick(0.2);
  assert(!state().paused && state().car.throttle < 0.1);
  env.event(env.nodes.get("home"), "click", { button: 0 });
  assert(!state().playing);
});
