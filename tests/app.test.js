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
const world = await import("../src/world.js");
const state = () => window.__DRIFT__.state;
test("game transitions, controls and wall-time countdown work together", () => {
  assert.equal(
    env.nodes.get("menu-best").textContent,
    "000000",
    "invalid saved scores must be ignored",
  );
  assert.equal(env.nodes.get("pause").disabled, true);
  env.click("help");
  assert.equal(env.document.activeElement.id, "dialog-action");
  env.key("Escape");
  assert(env.nodes.get("overlay").classList.contains("hidden"));
  const space = env.key("Space", "keydown", env.nodes.get("start"));
  assert(!space.defaultPrevented, "menu buttons keep native Space activation");
  env.click("start");
  assert(state().playing);
  assert(!state().paused);
  assert.equal(env.document.activeElement.id, "world");
  env.key("KeyW");
  for (let i = 0; i < 30; i++) env.tick(1 / 60);
  assert(state().car.speed > 1);
  env.blur();
  assert(state().paused);
  assert(env.nodes.get("touch").classList.contains("hidden"));
  const position = state().car.z;
  env.tick(10);
  assert.equal(state().car.z, position);
  env.click("dialog-action");
  assert(!state().paused);
  env.tick(0.1);
  assert(state().car.speed < 8, "held input must be cleared by pause");
  env.click("touch-camera");
  env.click("touch-camera");
  env.tick(0.016);
  assert.equal(
    world.car.visible,
    false,
    "hood camera must not sit inside visible cabin geometry",
  );
  env.click("touch-reset");
  assert.equal(state().car.speed, 0);
  env.key("Escape");
  env.click("return-menu");
  assert(state().paused);
  assert(env.nodes.get("dialog-body").innerHTML.includes("最佳圈速"));
  env.key("Escape");
  assert(state().paused, "free-run results cannot resume a finished session");
  env.click("return-menu");
  assert(!state().playing);
  env.tick(0.016);
  assert(world.car.visible);
  env.buttons.find((b) => b.dataset.mode === "challenge").click();
  env.click("start");
  for (let i = 0; i < 12; i++) env.tick(0.25);
  assert(
    Math.abs(state().remaining - 117) < 1e-9,
    "low FPS must not lengthen the challenge",
  );
  env.key("Escape");
  const remaining = state().remaining;
  env.tick(20);
  assert.equal(state().remaining, remaining);
  env.click("dialog-action");
  env.tick(118);
  assert.equal(state().remaining, 0);
  assert(state().paused);
  assert.equal(env.nodes.get("dialog-title").textContent, "山路记住了你。");
  const s = { ...world.spawn(), vx: 10, vz: 10, speed: 15 };
  world.updateEffects(s, 0.04, true);
  env.click("dialog-action");
  assert.equal(state().remaining, 120);
  assert(!state().paused);
  assert.equal(world.scene.getObjectByName("skid-marks").count, 0);
  const lost = env.event(env.nodes.get("world"), "webglcontextlost");
  assert(lost.defaultPrevented);
  assert(state().paused);
  env.click("dialog-action");
  assert(state().paused, "cannot resume before WebGL restoration");
  env.event(env.nodes.get("world"), "webglcontextrestored");
  env.click("dialog-action");
  assert(!state().paused);
});
test("notifications expire in the garage as well as while driving", () => {
  env.key("Escape");
  env.click("return-menu");
  env.click("return-menu");
  assert(!state().playing);
  env.event(env.nodes.get("world"), "webglcontextrestored");
  assert(env.nodes.get("notice").textContent.length > 0);
  env.tick(3);
  assert(env.nodes.get("notice").textContent.length > 0);
  env.tick(2);
  assert.equal(env.nodes.get("notice").textContent, "");
});
test("browser shortcuts do not steer the car or get trapped inside dialogs", () => {
  env.click("start");
  env.tick(0.016);
  const visible = world.car.visible;
  env.key("KeyC", "keydown", env.nodes.get("world"), { ctrlKey: true });
  env.tick(0.016);
  assert.equal(world.car.visible, visible, "Ctrl+C must not change cameras");
  env.key("KeyW", "keydown", env.nodes.get("world"), { metaKey: true });
  env.tick(0.1);
  assert.equal(
    state().car.speed,
    0,
    "browser modifier shortcuts must not press the throttle",
  );
  env.key("Escape");
  env.click("return-menu");
  env.click("return-menu");
  env.click("help");
  const tab = env.key("Tab", "keydown", env.nodes.get("dialog-action"), {
    ctrlKey: true,
  });
  assert(
    !tab.defaultPrevented,
    "Ctrl+Tab must remain available to the browser",
  );
  env.key("Escape");
});
