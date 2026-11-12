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
const env = createEnvironment(),
  doc = env.document;
let requests = 0;
const enter = async () => {
  requests++;
  doc.fullscreenElement = doc.documentElement;
  env.event(doc, "fullscreenchange");
};
doc.fullscreenEnabled = true;
doc.fullscreenElement = null;
doc.documentElement = doc.createElement("html");
doc.documentElement.requestFullscreen = enter;
doc.exitFullscreen = async () => {
  doc.fullscreenElement = null;
  env.event(doc, "fullscreenchange");
};
await import(appURL);
const state = () => window.__DRIFT__.state;
async function settle() {
  await Promise.resolve();
  await Promise.resolve();
}
test("fullscreen settings reflect the actual browser state and recover if entry is rejected", async () => {
  env.click("quality");
  assert(!env.nodes.get("display-options").classList.contains("hidden"));
  env.click("fullscreen");
  assert(env.nodes.get("fullscreen").disabled);
  await settle();
  assert.equal(doc.fullscreenElement, doc.documentElement);
  assert.equal(env.nodes.get("fullscreen")["aria-pressed"], "true");
  assert(!env.nodes.get("fullscreen").disabled);
  env.click("fullscreen");
  await settle();
  assert.equal(doc.fullscreenElement, null);
  doc.documentElement.requestFullscreen = async () => {
    throw new Error("denied");
  };
  env.click("fullscreen");
  await settle();
  assert(!env.nodes.get("fullscreen").disabled);
  assert(env.nodes.get("notice").textContent.includes("窗口驾驶"));
  doc.documentElement.requestFullscreen = enter;
  env.key("Escape");
});
test("F uses a user action and native fullscreen exit pauses driving and clears held input", async () => {
  env.click("start");
  const before = requests;
  env.key("KeyF", "keydown", env.nodes.get("world"), { ctrlKey: true });
  await settle();
  assert.equal(requests, before);
  const key = env.key("KeyF");
  await settle();
  assert(key.defaultPrevented);
  assert.equal(doc.fullscreenElement, doc.documentElement);
  env.key("KeyW");
  env.tick(0.2);
  assert(state().car.throttle > 0.5);
  doc.fullscreenElement = null;
  env.event(doc, "fullscreenchange");
  assert(state().paused);
  assert.equal(env.nodes.get("fullscreen")["aria-pressed"], "false");
  env.click("dialog-action");
  env.tick(0.3);
  assert(state().car.throttle < 0.05);
  env.key("Escape");
  env.click("return-menu");
  env.click("return-menu");
});
