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
const preferences = (value) => ({
  color: CAR_COLORS.includes(value?.color) ? value.color : CAR_COLORS[0],
  camera: [0, 1, 2].includes(value?.camera) ? value.camera : 0,
  quality: QUALITY_MODES.includes(value?.quality) ? value.quality : "auto",
  mode: isMode(value?.mode) ? value.mode : "free",
});
function readSaved(storage) {
  try {
    const saved = JSON.parse(storage?.getItem(PROFILE_KEY) || "null");
    return saved?.version === 1 ? saved : null;
  } catch {
    return null;
  }
}
function mergeRecord(previous, incoming) {
  return {
    score: Math.max(previous.score, incoming.score),
    bestChain: Math.max(previous.bestChain, incoming.bestChain),
    bestLap:
      previous.bestLap == null
        ? incoming.bestLap
        : incoming.bestLap == null
          ? previous.bestLap
          : Math.min(previous.bestLap, incoming.bestLap),
  };
}
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
    ...(typeof value.id === "string" && /^[a-zA-Z0-9-]{1,80}$/.test(value.id)
      ? { id: value.id }
      : {}),
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
function mergeHistory(...lists) {
  const unique = new Map();
  for (const value of lists.flat()) {
    const entry = session(value);
    if (!entry) continue;
    const key = entry.id || JSON.stringify(entry);
    if (!unique.has(key)) unique.set(key, entry);
  }
  return [...unique.values()].sort((a, b) => b.at - a.at).slice(0, 20);
}
export class DriverProfile {
  constructor(storage = readStorage()) {
    this.storage = storage;
    this.persistent = false;
    this.pendingPreferences = {};
    let saved = readSaved(storage) || {},
      legacyBest = 0;
    try {
      legacyBest = integer(Number(storage?.getItem("midnight-best")));
    } catch {}
    this.data = {
      version: 1,
      preferences: preferences(saved.preferences),
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
  refresh() {
    const saved = readSaved(this.storage);
    if (!saved) return;
    // Merge monotonic records and session IDs before writing a stale tab's data.
    this.data.preferences = {
      ...preferences(saved.preferences),
      ...this.pendingPreferences,
    };
    for (const mode of ["free", "challenge"])
      this.data.records[mode] = mergeRecord(
        this.data.records[mode],
        record(saved.records?.[mode]),
      );
    this.data.legacyBest = Math.max(
      this.data.legacyBest,
      integer(saved.legacyBest),
    );
    this.data.history = mergeHistory(
      this.data.history,
      Array.isArray(saved.history) ? saved.history : [],
    );
  }
  save() {
    this.refresh();
    try {
      if (!this.storage) throw new Error("Storage unavailable");
      this.storage.setItem(PROFILE_KEY, JSON.stringify(this.data));
      this.pendingPreferences = {};
      this.persistent = true;
    } catch {
      this.persistent = false;
    }
    return this.persistent;
  }
  setPreferences(patch) {
    this.refresh();
    const current = this.data.preferences,
      next = { ...current };
    if (CAR_COLORS.includes(patch.color)) next.color = patch.color;
    if ([0, 1, 2].includes(patch.camera)) next.camera = patch.camera;
    if (isMode(patch.mode)) next.mode = patch.mode;
    if (QUALITY_MODES.includes(patch.quality)) next.quality = patch.quality;
    if (JSON.stringify(current) === JSON.stringify(next))
      return this.persistent;
    for (const key of Object.keys(next))
      if (next[key] !== current[key]) this.pendingPreferences[key] = next[key];
    this.data.preferences = next;
    return this.save();
  }
  updateBest(mode, value) {
    this.refresh();
    const previous = this.best(mode),
      incoming = record(value);
    const next = mergeRecord(previous, incoming);
    if (JSON.stringify(previous) === JSON.stringify(next))
      return this.persistent;
    this.data.records[mode] = next;
    return this.save();
  }
  recordSession(value) {
    const entry = session(value);
    if (!entry) throw new TypeError("Invalid driving session");
    entry.id =
      globalThis.crypto?.randomUUID?.() ||
      `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
    this.data.records[entry.mode] = mergeRecord(
      this.best(entry.mode),
      record(entry),
    );
    this.data.history.unshift(entry);
    this.data.history.length = Math.min(this.data.history.length, 20);
    return this.save();
  }
}
