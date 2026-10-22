import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
const script = readFileSync(
  new URL("../index.html", import.meta.url),
  "utf8",
).match(/<script id="boot-guard">([\s\S]*?)<\/script>/)[1];
function boot() {
  const listeners = new Map(),
    make = (hidden) => {
      const classes = new Set(hidden ? ["hidden"] : []);
      return {
        classList: {
          contains: (c) => classes.has(c),
          add: (c) => classes.add(c),
          remove: (c) => classes.delete(c),
        },
        textContent: "loading",
      };
    };
  const nodes = {
    loading: make(false),
    "loading-title": make(false),
    "loading-retry": make(true),
  };
  let reloads = 0;
  const window = {
    addEventListener: (name, callback) => listeners.set(name, callback),
    location: { reload: () => reloads++ },
  };
  vm.runInNewContext(script, {
    window,
    document: { getElementById: (id) => nodes[id] },
  });
  return {
    nodes,
    fire: (name, event = {}) => listeners.get(name)({ ...event, type: name }),
    get reloads() {
      return reloads;
    },
  };
}
test("startup script failures show an explicit retry that reloads on user action", () => {
  const app = boot();
  app.fire("error", { target: { tagName: "SCRIPT" } });
  assert(!app.nodes["loading-retry"].classList.contains("hidden"));
  assert.equal(app.reloads, 0);
  app.nodes["loading-retry"].onclick();
  assert.equal(app.reloads, 1);
});
test("optional resource errors and errors after startup do not replace a running game", () => {
  const app = boot();
  app.fire("error", { target: { tagName: "IMG" } });
  assert(app.nodes["loading-retry"].classList.contains("hidden"));
  app.nodes.loading.classList.add("hidden");
  app.fire("unhandledrejection");
  assert(app.nodes["loading-retry"].classList.contains("hidden"));
});
test("script failures before body parsing are surfaced once the loading UI exists", () => {
  const app = boot(),
    loading = app.nodes.loading;
  delete app.nodes.loading;
  app.fire("error", { target: { tagName: "SCRIPT" } });
  app.nodes.loading = loading;
  app.fire("DOMContentLoaded");
  assert(!app.nodes["loading-retry"].classList.contains("hidden"));
});
