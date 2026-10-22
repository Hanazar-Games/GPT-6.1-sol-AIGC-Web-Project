import test from "node:test";
import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { createEnvironment } from "./support/environment.js";
import { DriverProfile } from "../src/profile.js";
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
test("quality changes persist, pause the drive and restore gameplay without losing time", () => {
  assert(
    !env.nodes.get("loading").classList.contains("hidden"),
    "loading must stay until a successful render",
  );
  env.tick(0.016);
  assert(env.nodes.get("loading").classList.contains("hidden"));
  env.click("start");
  env.tick(0.2);
  env.click("quality");
  assert(state().paused);
  const tab = env.key("Tab");
  assert(tab.defaultPrevented);
  assert.equal(env.document.activeElement.dataset.quality, "auto");
  const elapsed = state().elapsed;
  env.tick(3);
  assert.equal(state().elapsed, elapsed);
  env.buttons.find((b) => b.dataset.quality === "performance").click();
  assert.equal(state().quality, "performance");
  assert(state().resolution <= 1);
  assert.equal(
    new DriverProfile(env.storage).preferences.quality,
    "performance",
  );
  env.key("Escape");
  assert(!state().paused);
  env.tick(0.1);
  assert(state().elapsed > elapsed);
  env.resize(800, 600, 2);
  env.click("quality");
  env.buttons.find((b) => b.dataset.quality === "high").click();
  assert.equal(state().resolution, 2);
  env.click("dialog-action");
  assert(!state().paused);
  const before = state().renderedFrames;
  env.document.hidden = true;
  env.event(env.document, "visibilitychange");
  env.tick(10);
  assert(state().paused);
  assert.equal(state().renderedFrames, before);
  env.document.hidden = false;
  env.event(env.document, "visibilitychange");
  env.click("dialog-action");
  env.tick(0.016);
  assert(state().renderedFrames > before);
  env.key("Escape");
  env.click("return-menu");
  env.click("return-menu");
  const motion = env.media.get("(prefers-reduced-motion: reduce)");
  motion.matches = true;
  env.event(motion, "change");
  env.tick(0.016);
  const still = state().renderedFrames;
  for (let i = 0; i < 60; i++) env.tick(1 / 60);
  assert.equal(state().renderedFrames, still);
  env.buttons.find((b) => b.dataset.color === "#a78bfa").click();
  env.tick(0.016);
  assert(state().renderedFrames > still);
});
