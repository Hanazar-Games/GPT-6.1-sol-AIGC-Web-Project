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
  const write = env.storage.setItem;
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
  env.storage.setItem = write;
});
test("storage notifications refresh the garage record without changing the selected mode", () => {
  const otherTab = new DriverProfile(env.storage);
  otherTab.recordSession({ mode: "free", score: 600, at: 1000 });
  env.windowEvent("storage", { key: PROFILE_KEY });
  assert.equal(env.nodes.get("menu-best").textContent, "000600");
  assert.equal(window.__DRIFT__.state.mode, "free");
  env.click("records");
  assert(env.nodes.get("dialog-body").innerHTML.includes("000600"));
  env.click("dialog-action");
});
test("garage applies remote preferences while preserving this tab's selected game mode", () => {
  const other = new DriverProfile(env.storage);
  other.setPreferences({
    color: "#c3c9d6",
    camera: 2,
    quality: "performance",
    handling: "steady",
    mode: "challenge",
  });
  env.windowEvent("storage", { key: PROFILE_KEY });
  const s = window.__DRIFT__.state;
  assert.equal(s.mode, "free");
  assert.equal(s.handling, "steady");
  assert.equal(s.quality, "performance");
  assert.equal(world.paint.color.getHexString(), "c3c9d6");
  assert(env.nodes.get("handling-label").textContent.includes("稳健"));
  assert.equal(
    env.buttons.find((b) => b.dataset.color === "#c3c9d6")["aria-pressed"],
    "true",
  );
  env.click("start");
  env.tick(0.02);
  assert(
    !world.car.visible,
    "the restored hood camera must be used when the drive starts",
  );
  assert.equal(new DriverProfile(env.storage).preferences.mode, "free");
  env.key("Escape");
  env.click("return-menu");
  env.click("return-menu");
});
test("remote setup changes are deferred until returning to the garage", () => {
  env.click("start");
  env.key("KeyW");
  env.tick(0.2);
  const other = new DriverProfile(env.storage);
  other.setPreferences({
    color: "#a78bfa",
    camera: 0,
    quality: "high",
    handling: "wide",
  });
  env.windowEvent("storage", { key: PROFILE_KEY });
  assert.equal(window.__DRIFT__.state.handling, "steady");
  assert.equal(window.__DRIFT__.state.quality, "performance");
  assert.equal(world.paint.color.getHexString(), "c3c9d6");
  env.key("Escape");
  env.click("return-menu");
  env.click("return-menu");
  assert.equal(window.__DRIFT__.state.handling, "wide");
  assert.equal(window.__DRIFT__.state.quality, "high");
  assert.equal(world.paint.color.getHexString(), "a78bfa");
});
test("home navigation finishes and records a drive once without a page reload", () => {
  const before = new DriverProfile(env.storage).history.length;
  env.buttons.find((b) => b.dataset.mode === "challenge").click();
  env.click("start");
  env.tick(0.3);
  const modified = env.event(env.nodes.get("home"), "click", {
    ctrlKey: true,
    button: 0,
  });
  assert(
    !modified.defaultPrevented && window.__DRIFT__.state.playing,
    "modified link activation must retain normal browser navigation",
  );
  const event = env.event(env.nodes.get("home"), "click", { button: 0 });
  assert(event.defaultPrevented);
  assert(!window.__DRIFT__.state.playing);
  assert.equal(env.document.activeElement.id, "start");
  const saved = new DriverProfile(env.storage);
  assert.equal(saved.history.length, before + 1);
  assert.equal(saved.history[0].mode, "challenge");
  assert(!saved.history[0].completed);
  assert(Math.abs(saved.history[0].duration - 0.3) < 1e-8);
  env.event(env.nodes.get("home"), "click", { button: 0 });
  assert.equal(new DriverProfile(env.storage).history.length, before + 1);
});
