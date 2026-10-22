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
