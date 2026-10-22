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
    "midnight-best": "5000",
    [PROFILE_KEY]: JSON.stringify({
      version: 1,
      preferences: { color: "#a78bfa", camera: 1, mode: "free" },
      records: { free: { score: 400 }, challenge: { score: 800 } },
      history: [],
    }),
  },
});
await import(appURL);
const world = await import("../src/world.js");
test("garage restores preferences, separates records and saves one entry per finished drive", () => {
  assert.equal(world.paint.color.getHexString(), "a78bfa");
  assert.equal(env.nodes.get("menu-best").textContent, "000400");
  env.buttons.find((b) => b.dataset.mode === "challenge").click();
  assert.equal(env.nodes.get("menu-best").textContent, "000800");
  env.buttons.find((b) => b.dataset.mode === "free").click();
  assert.equal(env.nodes.get("menu-best").textContent, "000400");
  env.click("records");
  assert(env.nodes.get("dialog-body").innerHTML.includes("005000"));
  assert(env.nodes.get("dialog-body").innerHTML.includes("还没有驾驶记录"));
  env.key("Escape");
  assert(env.nodes.get("overlay").classList.contains("hidden"));
  env.click("start");
  env.tick(0.016);
  env.key("KeyC");
  env.tick(0.016);
  assert(!world.car.visible, "saved camera 1 must cycle to hood camera 2");
  env.key("Escape");
  env.click("return-menu");
  assert(
    env.nodes.get("dialog-body").innerHTML.includes("本模式最高分 000400"),
  );
  env.click("return-menu");
  const saved = new DriverProfile(env.storage);
  assert.equal(saved.history.length, 1);
  assert.equal(saved.history[0].mode, "free");
  assert.equal(saved.best("free").score, 400);
  assert.equal(saved.best("challenge").score, 800);
  assert.equal(saved.preferences.camera, 2);
  env.click("records");
  const body = env.nodes.get("dialog-body").innerHTML;
  assert(body.includes("history-row"));
  assert(!body.includes("还没有驾驶记录"));
  env.click("dialog-action");
  env.buttons.find((b) => b.dataset.color === "#f66b43").click();
  assert.equal(new DriverProfile(env.storage).preferences.color, "#f66b43");
  env.storage.setItem = () => {
    throw new Error("quota");
  };
  env.click("start");
  env.tick(1);
  env.key("Escape");
  env.click("return-menu");
  assert(env.nodes.get("dialog-body").innerHTML.includes("浏览器存储不可用"));
  env.click("return-menu");
  env.click("records");
  assert(env.nodes.get("dialog-body").innerHTML.includes("2 / 20"));
  env.click("dialog-action");
});
