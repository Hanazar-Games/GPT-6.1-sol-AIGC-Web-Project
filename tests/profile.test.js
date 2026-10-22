import test from "node:test";
import assert from "node:assert/strict";
import { DriverProfile, PROFILE_KEY } from "../src/profile.js";
const storage = (initial = {}) => {
  const data = new Map(Object.entries(initial));
  return {
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => data.set(key, String(value)),
  };
};
const entry = (score, mode = "free", at = Date.now()) => ({
  mode,
  score,
  at,
  duration: 120,
  distance: 1000,
  topSpeed: 30,
  bestChain: 100,
  laps: 2,
  bestLap: 52.5,
  completed: true,
});
test("mode scores and preferences survive reload without mixing free and timed records", () => {
  const store = storage(),
    profile = new DriverProfile(store);
  profile.updateBest("free", { score: 5000, bestLap: 50 });
  profile.updateBest("challenge", { score: 700, bestLap: 52 });
  profile.setPreferences({ color: "#a78bfa", camera: 2, mode: "challenge" });
  const reloaded = new DriverProfile(store);
  assert.equal(reloaded.best("free").score, 5000);
  assert.equal(reloaded.best("challenge").score, 700);
  assert.deepEqual(reloaded.preferences, {
    color: "#a78bfa",
    camera: 2,
    mode: "challenge",
    quality: "auto",
  });
  reloaded.updateBest("challenge", { score: 100, bestLap: 55 });
  assert.equal(reloaded.best("challenge").score, 700);
  assert.equal(reloaded.best("challenge").bestLap, 52);
});
test("history retains twenty recent sessions while older personal bests remain intact", () => {
  const store = storage(),
    profile = new DriverProfile(store);
  profile.recordSession(entry(10000));
  for (let i = 0; i < 25; i++) profile.recordSession(entry(i));
  assert.equal(profile.history.length, 20);
  assert.equal(profile.history[0].score, 24);
  assert.equal(profile.history.at(-1).score, 5);
  const reloaded = new DriverProfile(store);
  assert.equal(reloaded.best("free").score, 10000);
  assert.equal(reloaded.history.length, 20);
});
test("legacy scores remain archived without being assigned to either mode", () => {
  const store = storage({
      "midnight-best": "12345",
      [PROFILE_KEY]: "{broken json",
    }),
    profile = new DriverProfile(store);
  assert.equal(profile.legacyBest, 12345);
  assert.equal(profile.best("free").score, 0);
  assert.equal(profile.best("challenge").score, 0);
  profile.setPreferences({ camera: 1 });
  assert.equal(new DriverProfile(store).legacyBest, 12345);
  assert.equal(store.getItem("midnight-best"), "12345");
});
test("blocked storage keeps the current session playable and reports unsaved data", () => {
  const unavailable = {
    getItem() {
      throw new Error("blocked");
    },
    setItem() {
      throw new Error("quota");
    },
  };
  const profile = new DriverProfile(unavailable);
  assert.equal(profile.recordSession(entry(600, "challenge")), false);
  assert.equal(profile.best("challenge").score, 600);
  assert.equal(profile.history.length, 1);
  assert.equal(profile.persistent, false);
});
test("corrupt stored values cannot introduce invalid dates, modes, palette or scores", () => {
  const profile = new DriverProfile(
    storage({
      [PROFILE_KEY]: JSON.stringify({
        version: 1,
        preferences: { color: "<script>", camera: 9, mode: "invalid" },
        records: { free: { score: -1, bestLap: 0 } },
        history: [
          { ...entry(50), duration: 1e308, topSpeed: 1e308, bestLap: 1e308 },
          entry(20, "invalid"),
          entry(10, "free", 1e20),
        ],
      }),
    }),
  );
  assert.deepEqual(profile.preferences, {
    color: "#b8ed50",
    camera: 0,
    mode: "free",
    quality: "auto",
  });
  assert.equal(profile.best("free").score, 0);
  assert.equal(profile.best("free").bestLap, null);
  assert.equal(profile.history.length, 1);
  assert.equal(profile.history[0].duration, 0);
  assert.equal(profile.history[0].topSpeed, 0);
  assert.equal(profile.history[0].bestLap, null);
  assert.throws(() => profile.recordSession(entry(-1)), TypeError);
});
test("profile snapshots cannot mutate the underlying archive", () => {
  const profile = new DriverProfile(storage());
  profile.recordSession(entry(400));
  profile.history[0].score = 999;
  profile.best("free").score = 999;
  profile.preferences.color = "bad";
  assert.equal(profile.history[0].score, 400);
  assert.equal(profile.best("free").score, 400);
  assert.equal(profile.preferences.color, "#b8ed50");
});
test("stale tabs preserve each other's records, sessions and unrelated preferences", () => {
  const store = storage(),
    first = new DriverProfile(store),
    second = new DriverProfile(store);
  first.recordSession(entry(900, "free", 1000));
  first.setPreferences({ color: "#a78bfa" });
  second.recordSession(entry(500, "challenge", 2000));
  second.setPreferences({ camera: 2 });
  first.updateBest("free", { score: 1000, bestLap: 50 });
  const saved = new DriverProfile(store);
  assert.equal(saved.best("free").score, 1000);
  assert.equal(saved.best("challenge").score, 500);
  assert.deepEqual(
    saved.history.map((run) => run.score),
    [500, 900],
  );
  assert.equal(saved.preferences.color, "#a78bfa");
  assert.equal(saved.preferences.camera, 2);
});
test("session IDs retain identical drives and repeated merges do not duplicate old history", () => {
  const original = entry(200, "free", 1000),
    store = storage({
      [PROFILE_KEY]: JSON.stringify({ version: 1, history: [original] }),
    }),
    first = new DriverProfile(store),
    second = new DriverProfile(store);
  first.recordSession(original);
  second.recordSession(original);
  first.setPreferences({ camera: 1 });
  second.setPreferences({ quality: "performance" });
  const saved = new DriverProfile(store);
  assert.equal(saved.history.length, 3);
  assert.equal(new Set(saved.history.map((run) => run.id)).size, 3);
  assert.equal(saved.history.filter((run) => !run.id).length, 1);
});
test("merging two tabs keeps the latest twenty sessions and both modes' best laps", () => {
  const store = storage(),
    first = new DriverProfile(store),
    second = new DriverProfile(store);
  for (let i = 0; i < 30; i++)
    (i % 2 ? first : second).recordSession(
      entry(i, i % 2 ? "free" : "challenge", i),
    );
  first.updateBest("challenge", { bestLap: 40 });
  second.updateBest("free", { bestLap: 45 });
  const saved = new DriverProfile(store);
  assert.deepEqual(
    saved.history.map((run) => run.at),
    Array.from({ length: 20 }, (_, i) => 29 - i),
  );
  assert.equal(saved.best("challenge").bestLap, 40);
  assert.equal(saved.best("free").bestLap, 45);
});
test("failed preference writes survive external updates and a later successful save", () => {
  const store = storage(),
    first = new DriverProfile(store),
    second = new DriverProfile(store),
    write = store.setItem;
  store.setItem = () => {
    throw new Error("quota");
  };
  assert.equal(first.setPreferences({ color: "#f66b43" }), false);
  store.setItem = write;
  second.setPreferences({ camera: 2 });
  second.recordSession(entry(300));
  first.recordSession(entry(700, "challenge"));
  const saved = new DriverProfile(store);
  assert.equal(saved.preferences.color, "#f66b43");
  assert.equal(saved.preferences.camera, 2);
  assert.equal(saved.history.length, 2);
});
test("finishing a drive persists its record and history in a single write", () => {
  const store = storage(),
    write = store.setItem;
  let writes = 0;
  store.setItem = (...args) => {
    writes++;
    write(...args);
  };
  const profile = new DriverProfile(store);
  profile.recordSession(entry(900));
  assert.equal(writes, 1);
  assert.equal(new DriverProfile(store).best("free").score, 900);
  assert.equal(new DriverProfile(store).history.length, 1);
});
