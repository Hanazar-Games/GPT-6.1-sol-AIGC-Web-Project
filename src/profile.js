import { QUALITY_MODES } from "./quality.js";
export const PROFILE_KEY = "midnight-driver-v1";
export const CAR_COLORS = ["#b8ed50", "#f66b43", "#c3c9d6", "#a78bfa"];
const isMode = (mode) => mode === "free" || mode === "challenge";
const number = (value, fallback = 0, maximum = Number.MAX_SAFE_INTEGER) =>
  typeof value === "number" &&
  Number.isFinite(value) &&
  value >= 0 &&
  value <= maximum
    ? value
    : fallback;
const integer = (value) =>
  Number.isSafeInteger(value) && value >= 0 ? value : 0;
const lap = (value) =>
  typeof value === "number" &&
  Number.isFinite(value) &&
  value > 0 &&
  value <= 1e9
    ? value
    : null;
const record = (value) => ({
  score: integer(value?.score),
  bestLap: lap(value?.bestLap),
  bestChain: integer(value?.bestChain),
});
function readStorage() {
  try {
    return globalThis.localStorage;
  } catch {
    return null;
  }
}
function session(value) {
  if (
    !value ||
    !isMode(value.mode) ||
    !Number.isSafeInteger(value.score) ||
    value.score < 0 ||
    !Number.isFinite(value.at) ||
    value.at < 0 ||
    value.at > 8.64e15
  )
    return null;
  return {
    mode: value.mode,
    score: value.score,
    at: value.at,
    duration: number(value.duration, 0, 1e9),
    distance: number(value.distance, 0, 1e12),
    topSpeed: number(value.topSpeed, 0, 1000),
    bestChain: integer(value.bestChain),
    laps: integer(value.laps),
    bestLap: lap(value.bestLap),
    completed: value.completed === true,
  };
}
export class DriverProfile {
  constructor(storage = readStorage()) {
    this.storage = storage;
    this.persistent = false;
    let saved = {},
      legacyBest = 0;
    try {
      const parsed = JSON.parse(storage?.getItem(PROFILE_KEY) || "{}");
      if (parsed?.version === 1) saved = parsed;
    } catch {}
    try {
      legacyBest = integer(Number(storage?.getItem("midnight-best")));
    } catch {}
    this.data = {
      version: 1,
      preferences: {
        color: CAR_COLORS.includes(saved.preferences?.color)
          ? saved.preferences.color
          : CAR_COLORS[0],
        camera: [0, 1, 2].includes(saved.preferences?.camera)
          ? saved.preferences.camera
          : 0,
        quality: QUALITY_MODES.includes(saved.preferences?.quality)
          ? saved.preferences.quality
          : "auto",
        mode: isMode(saved.preferences?.mode) ? saved.preferences.mode : "free",
      },
      records: {
        free: record(saved.records?.free),
        challenge: record(saved.records?.challenge),
      },
      legacyBest: Math.max(legacyBest, integer(saved.legacyBest)),
      history: Array.isArray(saved.history)
        ? saved.history.map(session).filter(Boolean).slice(0, 20)
        : [],
    };
  }
  get preferences() {
    return { ...this.data.preferences };
  }
  get history() {
    return this.data.history.map((value) => ({ ...value }));
  }
  get legacyBest() {
    return this.data.legacyBest;
  }
  best(mode) {
    if (!isMode(mode)) throw new TypeError("Unknown driving mode");
    return { ...this.data.records[mode] };
  }
  save() {
    try {
      if (!this.storage) throw new Error("Storage unavailable");
      this.storage.setItem(PROFILE_KEY, JSON.stringify(this.data));
      this.persistent = true;
    } catch {
      this.persistent = false;
    }
    return this.persistent;
  }
  setPreferences(patch) {
    const current = this.data.preferences,
      next = { ...current };
    if (CAR_COLORS.includes(patch.color)) next.color = patch.color;
    if ([0, 1, 2].includes(patch.camera)) next.camera = patch.camera;
    if (isMode(patch.mode)) next.mode = patch.mode;
    if (QUALITY_MODES.includes(patch.quality)) next.quality = patch.quality;
    if (JSON.stringify(current) === JSON.stringify(next))
      return this.persistent;
    this.data.preferences = next;
    return this.save();
  }
  updateBest(mode, value) {
    const previous = this.best(mode),
      incoming = record(value);
    const next = {
      score: Math.max(previous.score, incoming.score),
      bestChain: Math.max(previous.bestChain, incoming.bestChain),
      bestLap:
        incoming.bestLap == null
          ? previous.bestLap
          : previous.bestLap == null
            ? incoming.bestLap
            : Math.min(previous.bestLap, incoming.bestLap),
    };
    if (JSON.stringify(previous) === JSON.stringify(next))
      return this.persistent;
    this.data.records[mode] = next;
    return this.save();
  }
  recordSession(value) {
    const entry = session(value);
    if (!entry) throw new TypeError("Invalid driving session");
    this.updateBest(entry.mode, entry);
    this.data.history.unshift(entry);
    this.data.history.length = Math.min(this.data.history.length, 20);
    return this.save();
  }
}
