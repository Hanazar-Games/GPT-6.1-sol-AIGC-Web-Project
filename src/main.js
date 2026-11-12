import "./style.css";
import * as T from "three";
import {
  scene,
  car,
  paint,
  wheels,
  samples,
  tangents,
  spawn,
  nearestRoad,
  HALF_WIDTH,
  updateEffects,
  resetEffects,
  breakEffectsTrail,
  groundEffects,
  setBrake,
} from "./world.js";
import {
  createCarState,
  stepCar,
  resolveBarrier,
  DriftScore,
  clamp,
} from "./physics.js";
import { EngineAudio } from "./audio.js";
import { InputState } from "./input.js";
import { SessionClock } from "./clock.js";
import { LapTracker, formatLap } from "./laps.js";
import { DriverProfile, PROFILE_KEY } from "./profile.js";
import { RenderQuality, RenderSchedule } from "./quality.js";
import { createMinimap } from "./minimap.js";
import { Drivetrain, REDLINE_RPM } from "./drivetrain.js";
import { drivingCameraHeading } from "./camera.js";
import { VehiclePresentation } from "./presentation.js";
import { drivingFeedback } from "./feedback.js";
import { handlingProfile } from "./handling.js";
import { FullscreenControl } from "./fullscreen.js";
const $ = (id) => document.getElementById(id);
let renderer;
try {
  renderer = new T.WebGLRenderer({
    canvas: $("world"),
    antialias: true,
    powerPreference: "high-performance",
  });
} catch (error) {
  $("loading").innerHTML =
    "<b>当前浏览器无法启动 3D 场景<span>请开启硬件加速，或使用支持 WebGL 2 的浏览器。</span></b>";
  throw error;
}
renderer.setSize(innerWidth, innerHeight);
renderer.outputColorSpace = T.SRGBColorSpace;
renderer.toneMapping = T.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.25;
const camera = new T.PerspectiveCamera(48, innerWidth / innerHeight, 0.1, 1800);
const audio = new EngineAudio();
const drivetrain = new Drivetrain();
const keys = new InputState();
const fullscreen = new FullscreenControl(document);
const fullscreenButton = $("fullscreen");
const inputButtons = [...document.querySelectorAll("[data-key]")];
const arrowAliases = {
  KeyW: "ArrowUp",
  KeyS: "ArrowDown",
  KeyA: "ArrowLeft",
  KeyD: "ArrowRight",
};
const clock = new SessionClock();
const profile = new DriverProfile();
const preferences = profile.preferences;
const quality = new RenderQuality(preferences.quality, {
  width: innerWidth,
  height: innerHeight,
  dpr: devicePixelRatio,
});
const renderSchedule = new RenderSchedule();
const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)");
renderer.setPixelRatio(quality.ratio);
let sceneReady = false,
  renderedFrames = 0;
let playing = false,
  paused = false,
  mode = preferences.mode,
  cameraMode = preferences.camera,
  handlingMode = preferences.handling,
  sessionSaved = false,
  personalBestAtStart = 0,
  score = new DriftScore(),
  carState,
  menuTime = 0,
  last = 0,
  accumulator = 0,
  noticeUntil = 0,
  laps,
  sessionStats,
  contextLost = false;
const format = (n) => Math.floor(n).toString().padStart(6, "0");
function updateGarageRecord() {
  $("menu-best").textContent = format(profile.best(mode).score);
  $("best-label").textContent =
    mode === "free" ? "FREE RUN BEST" : "120 SEC BEST";
}
updateGarageRecord();
for (const button of document.querySelectorAll("[data-mode]")) {
  const selected = button.dataset.mode === mode;
  button.classList.toggle("selected", selected);
  button.setAttribute("aria-pressed", String(selected));
}
const p = spawn();
carState = createCarState(p.x, p.z, p.yaw);
const presentation = new VehiclePresentation(carState);
const renderState = presentation.sample(1);
laps = new LapTracker(nearestRoad(p.x, p.z).progress);
sessionStats = { distance: 0, topSpeed: 0, bestChain: 0 };
car.position.set(p.x, 0, p.z);
car.rotation.y = p.yaw;
const touchMedia = matchMedia("(any-pointer: coarse)");
const touchDevice = () => touchMedia.matches;
let previousFocus;
let dialogKind = null;
let onDialog = () => {};
function dialog(kicker, title, body, action, callback) {
  $("quality-options").classList.add("hidden");
  $("handling-options").classList.add("hidden");
  $("display-options").classList.add("hidden");
  $("dialog-kicker").textContent = kicker;
  $("dialog-title").textContent = title;
  $("dialog-body").innerHTML = body;
  $("dialog-action").innerHTML = action + "<span>↗</span>";
  previousFocus = document.activeElement;
  $("overlay").classList.remove("hidden");
  $("dialog-action").focus();
  onDialog = callback;
}
function closeDialog() {
  $("overlay").classList.add("hidden");
  dialogKind = null;
  if (playing) $("world").focus({ preventScroll: true });
  else previousFocus?.focus({ preventScroll: true });
}
$("dialog-action").onclick = () => {
  if (contextLost) return;
  closeDialog();
  onDialog();
};
function showHelp() {
  dialogKind = "help";
  dialog(
    "DRIVER’S BRIEFING",
    "山路，交给你了。",
    '<div class="control-row"><span>油门 / 刹车与倒车</span><span><kbd>W / ↑</kbd><kbd>S / ↓</kbd></span></div><div class="control-row"><span>转向</span><span><kbd>A / ←</kbd><kbd>D / →</kbd></span></div><div class="control-row"><span>手刹 / 甩尾</span><kbd>SPACE</kbd></div><div class="control-row"><span>切换镜头 / 重置车辆</span><span><kbd>C</kbd><kbd>R</kbd></span></div><p>入弯前减速，转向后短按手刹。松开手刹，及时向车尾滑出的方向反打。保持油门可以维持漂移，松开方向也能接住侧滑；左右方向调整漂移方向，反打可切换甩尾。松开油门与方向，后轮逐步恢复抓地并收车。长按手刹会锁住后轮并损失速度。连续漂移提高倍率，回正 1.6 秒后结算。撞护栏会失去当前连击。</p><p>按住 B（或低速时 W+S）原地烧胎：前轮制动、后轮空转。松开即可结束，按住 Space 会锁住后轮。触屏设备使用屏幕底部的驾驶按钮。仪表 L/R 显示漂移方向和角度，GAS/BRK 显示实际油门与制动；RECOVER 表示收车，COAST 表示松油滑行。点击顶部标志会结算当前驾驶并返回车库。</p>' +
      (fullscreen.supported
        ? "<p>按 F 或在设置中切换全屏；退出全屏会暂停驾驶。</p>"
        : ""),
    "准备好了",
    () => {},
  );
}
$("help").onclick = showHelp;
function showRecords() {
  profile.refresh();
  dialogKind = "records";
  const labels = { free: "自由漂移", challenge: "限时挑战" };
  const summaries = ["free", "challenge"]
    .map((key) => {
      const best = profile.best(key);
      return `<div class="record-summary"><span>${labels[key]}</span><b>${format(best.score)}</b><small>最佳圈速 ${formatLap(best.bestLap)}</small></div>`;
    })
    .join("");
  const dateFormat = new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
  const history = profile.history;
  const rows = history
    .map(
      (entry) =>
        `<li class="history-row"><div><b>${labels[entry.mode]}</b><small>${dateFormat.format(new Date(entry.at))} · ${entry.mode === "challenge" && !entry.completed ? "提前结束" : "已完成"}</small></div><div><strong>${format(entry.score)}</strong><small>${formatLap(entry.duration)} · ${(entry.distance / 1000).toFixed(2)} km</small></div></li>`,
    )
    .join("");
  const legacy =
    profile.legacyBest > 0
      ? `<p class="archive-note">旧版综合纪录 ${format(profile.legacyBest)} 已保留；新纪录按模式独立记录。</p>`
      : "";
  dialog(
    "DRIVER ARCHIVE / 本机档案",
    "每次出发，都有记录。",
    `<div class="record-summaries">${summaries}</div>${legacy}<div class="history-heading"><span>最近驾驶</span><small>${history.length} / 20</small></div>${history.length ? `<ol class="history-list">${rows}</ol>` : '<p class="empty-history">还没有驾驶记录。完成一次驾驶，留下你的第一条轨迹。</p>'}`,
    "返回车库",
    () => {},
  );
}
$("records").onclick = showRecords;
const qualityLabels = { auto: "自动", performance: "流畅", high: "精细" };
function updateQualityControls() {
  for (const button of document.querySelectorAll("[data-quality]")) {
    const selected = button.dataset.quality === quality.mode;
    button.classList.toggle("selected", selected);
    button.setAttribute("aria-pressed", String(selected));
  }
  for (const button of document.querySelectorAll("[data-handling]")) {
    const selected = button.dataset.handling === handlingMode;
    button.classList.toggle("selected", selected);
    button.setAttribute("aria-pressed", String(selected));
  }
  const label = handlingProfile(handlingMode).label;
  $("handling-label").textContent = `${label} ↗`;
  $("session-mode").textContent =
    `${mode === "free" ? "FREE RUN / 自由漂移" : "TIME ATTACK / 限时挑战"} · ${label}`;
  $("quality").setAttribute(
    "aria-label",
    `驾驶设置：${label}；画质：${qualityLabels[quality.mode]}`,
  );
  $("quality").title = `驾驶：${label} / 画质：${qualityLabels[quality.mode]}`;
}
function applyGaragePreferences() {
  const saved = profile.preferences;
  paint.color.set(saved.color);
  cameraMode = saved.camera;
  handlingMode = saved.handling;
  if (quality.mode !== saved.quality) {
    quality.setMode(saved.quality);
    renderer.setPixelRatio(quality.ratio);
  }
  for (const button of document.querySelectorAll("[data-color]")) {
    const selected = button.dataset.color === saved.color;
    button.classList.toggle("active", selected);
    button.setAttribute("aria-pressed", String(selected));
  }
  updateQualityControls();
  renderSchedule.invalidate();
}
function showQuality() {
  if (dialogKind === "quality" || dialogKind === "result") return;
  const resumeAfter = playing && !paused;
  const returnToPause = playing && paused && dialogKind === "pause";
  if (resumeAfter) togglePause();
  dialogKind = "quality";
  dialog(
    "FIND YOUR FLOW / 驾驶与画面",
    "找到你的漂移节奏。",
    "<p>稳健适合熟悉路线；均衡兼顾角度与响应；大角度适合练习更深的侧滑。选择会自动保留。</p>",
    resumeAfter ? "继续驾驶" : returnToPause ? "返回暂停" : "完成",
    () => {
      if (resumeAfter) resume();
      else if (returnToPause) showPauseDialog();
    },
  );
  $("quality-options").classList.remove("hidden");
  $("handling-options").classList.remove("hidden");
  $("display-options").classList.toggle("hidden", !fullscreen.supported);
  updateQualityControls();
}
$("quality").onclick = showQuality;
$("handling-shortcut").onclick = showQuality;
for (const button of document.querySelectorAll("[data-handling]"))
  button.onclick = () => {
    handlingMode = handlingProfile(button.dataset.handling).id;
    profile.setPreferences({ handling: handlingMode });
    updateQualityControls();
  };
for (const button of document.querySelectorAll("[data-quality]"))
  button.onclick = () => {
    quality.setMode(button.dataset.quality);
    profile.setPreferences({ quality: quality.mode });
    renderer.setPixelRatio(quality.ratio);
    renderSchedule.invalidate();
    updateQualityControls();
  };
applyGaragePreferences();
function updateFullscreenControls() {
  $("fullscreen-help").classList.toggle("hidden", !fullscreen.supported);
  fullscreenButton.classList.toggle("hidden", !fullscreen.supported);
  fullscreenButton.disabled = fullscreen.pending;
  fullscreenButton.setAttribute("aria-pressed", String(fullscreen.active));
  fullscreenButton.setAttribute(
    "aria-label",
    fullscreen.active ? "退出全屏" : "全屏驾驶",
  );
  fullscreenButton.textContent = `${fullscreen.active ? "退出全屏" : "全屏驾驶"} · F`;
}
async function toggleFullscreen() {
  if (!fullscreen.supported || fullscreen.pending) return;
  const changing = fullscreen.toggle();
  updateFullscreenControls();
  try {
    await changing;
  } catch {
    notify("浏览器未能切换全屏，可继续窗口驾驶", 3);
  } finally {
    updateFullscreenControls();
    renderSchedule.invalidate();
  }
}
fullscreenButton.onclick = toggleFullscreen;
updateFullscreenControls();
let previousFullscreen = fullscreen.active;
document.addEventListener("fullscreenchange", () => {
  const exited = previousFullscreen && !fullscreen.active;
  previousFullscreen = fullscreen.active;
  if (exited && playing && !paused) togglePause();
  updateFullscreenControls();
  resizeRenderer();
});
reducedMotion.addEventListener("change", () => renderSchedule.invalidate());
function clearInput() {
  keys.clear();
  syncInputButtons();
}
function syncInputButtons() {
  for (const button of inputButtons)
    button.classList.toggle(
      "pressed",
      keys.has(button.dataset.key) ||
        keys.has(arrowAliases[button.dataset.key]),
    );
}
function saveBest() {
  profile.updateBest(mode, {
    score: score.total,
    bestLap: laps.best,
    bestChain: Math.floor(sessionStats.bestChain),
  });
  updateGarageRecord();
}
function start() {
  if (contextLost) return;
  profile.refresh();
  applyGaragePreferences();
  // Starting is an explicit choice of this tab's selected game mode. Refresh
  // other preferences first so that this write cannot restore stale settings.
  profile.setPreferences({ mode });
  clearInput();
  sessionSaved = false;
  personalBestAtStart = profile.best(mode).score;
  playing = true;
  paused = false;
  $("quality").disabled = false;
  audio.setActive(true);
  clock.reset(mode);
  accumulator = 0;
  last = performance.now();
  resetEffects();
  wheels.forEach((wheel) => wheel.rotation.set(0, 0, 0));
  car.rotation.z = 0;
  car.rotation.x = 0;
  score = new DriftScore();
  const s = spawn();
  carState = createCarState(s.x, s.z, s.yaw);
  presentation.reset(carState);
  presentation.sample(1, renderState);
  drivetrain.reset();
  laps = new LapTracker(nearestRoad(s.x, s.z).progress);
  sessionStats = { distance: 0, topSpeed: 0, bestChain: 0 };
  document.body.classList.add("playing");
  $("hud").classList.remove("hidden");
  $("overlay").classList.add("hidden");
  $("timer").classList.toggle("hidden", mode !== "challenge");
  updateQualityControls();
  $("touch").classList.toggle("hidden", !touchDevice());
  $("pause").disabled = false;
  $("world").focus({ preventScroll: true });
  dialogKind = null;
  hudTime = Infinity;
  updateHUD(0);
  resetCamera();
  notify("保持油门，前往第一个弯道", 4);
}
$("start").onclick = start;
function menu() {
  score.bank();
  saveBest();
  playing = false;
  paused = false;
  profile.refresh();
  applyGaragePreferences();
  car.rotation.z = 0;
  car.rotation.x = 0;
  resetEffects();
  renderSchedule.invalidate();
  audio.setActive(false);
  clearInput();
  document.body.classList.remove("playing");
  $("hud").classList.add("hidden");
  $("touch").classList.add("hidden");
  closeDialog();
  $("start").focus({ preventScroll: true });
  $("pause").disabled = true;
  $("quality").disabled = false;
}
function resume() {
  if (contextLost) return;
  paused = false;
  audio.setActive(true);
  accumulator = 0;
  last = performance.now();
  closeDialog();
  $("touch").classList.toggle("hidden", !touchDevice());
}
function togglePause() {
  if (!playing || clock.finished || dialogKind === "result") return;
  if (paused) {
    resume();
    return;
  }
  paused = true;
  audio.setActive(false);
  clearInput();
  $("touch").classList.add("hidden");
  showPauseDialog();
}
function showPauseDialog() {
  dialogKind = "pause";
  dialog(
    "TAKE A BREATHER",
    "暂停，夜还很长。",
    '<p>你的漂移记录已保留。准备好后，继续征服弯道。</p><button class="secondary" id="return-menu">结束驾驶 / 查看成绩</button>',
    "继续驾驶",
    resume,
  );
  $("return-menu").onclick = finish;
}
$("pause").onclick = togglePause;
$("sound").onclick = async () => {
  $("sound").disabled = true;
  try {
    const enabled = await audio.toggle();
    $("sound").innerHTML = enabled ? "♪" : '♪<span class="off-slash">／</span>';
    $("sound").setAttribute("aria-label", enabled ? "关闭声音" : "开启声音");
  } catch {
    notify("浏览器暂时无法播放音频");
  } finally {
    $("sound").disabled = false;
  }
};
for (const b of document.querySelectorAll("[data-mode]"))
  b.onclick = () => {
    mode = b.dataset.mode;
    profile.setPreferences({ mode });
    updateGarageRecord();
    document.querySelectorAll("[data-mode]").forEach((x) => {
      x.classList.toggle("selected", x === b);
      x.setAttribute("aria-pressed", String(x === b));
    });
  };
for (const b of document.querySelectorAll("[data-color]"))
  b.onclick = () => {
    paint.color.set(b.dataset.color);
    renderSchedule.invalidate();
    profile.setPreferences({ color: b.dataset.color });
    document.querySelectorAll("[data-color]").forEach((x) => {
      x.classList.toggle("active", x === b);
      x.setAttribute("aria-pressed", String(x === b));
    });
  };
function notify(text, duration = 2) {
  $("notice").textContent = text;
  noticeUntil = performance.now() + duration * 1000;
}
function reset() {
  const near = nearestRoad(carState.x, carState.z),
    t = tangents[near.index];
  carState = createCarState(near.x, near.z, Math.atan2(t.x, t.z));
  presentation.reset(carState);
  presentation.sample(1, renderState);
  accumulator = 0;
  breakEffectsTrail();
  car.rotation.x = 0;
  car.rotation.z = 0;
  drivetrain.reset();
  score.reset();
  laps.reanchor(near.progress, clock.elapsed);
  resetCamera();
  hudTime = Infinity;
  updateHUD(0);
  notify("已返回赛道 · 本圈不计圈速，过线后重新计时", 3);
}
addEventListener("keydown", (e) => {
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  if (!$("overlay").classList.contains("hidden")) {
    if (e.code === "Escape" && !e.repeat) {
      e.preventDefault();
      if (dialogKind === "help" || dialogKind === "records") closeDialog();
      else if (dialogKind === "pause") resume();
      else if (dialogKind === "quality") $("dialog-action").click();
    }
    if (e.code === "Tab") {
      const buttons = [
        ...$("overlay").querySelectorAll("button:not(:disabled)"),
      ].filter((button) => button.getClientRects().length > 0);
      const first = buttons[0],
        end = buttons.at(-1);
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        end.focus();
      } else if (!e.shiftKey && document.activeElement === end) {
        e.preventDefault();
        first.focus();
      }
    }
    return;
  }
  if (e.code === "Escape") {
    if (!e.repeat) togglePause();
    return;
  }
  const interactive = e.target.closest?.("button,a,input,select,textarea");
  if (e.code === "KeyF" && !e.repeat && !interactive) {
    if (fullscreen.supported) e.preventDefault();
    toggleFullscreen();
    return;
  }
  if (e.code === "Enter" && !playing && !interactive) {
    e.preventDefault();
    if (!e.repeat) start();
    return;
  }
  if (!playing || paused || (interactive && e.code === "Space")) return;
  if (
    ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Space"].includes(
      e.code,
    )
  )
    e.preventDefault();
  if (e.repeat) return;
  if (e.code === "KeyR") reset();
  if (e.code === "KeyC") cycleCamera();
  keys.press("key:" + e.code, e.code);
  syncInputButtons();
});
addEventListener("keyup", (e) => {
  keys.release("key:" + e.code);
  syncInputButtons();
});
function cycleCamera() {
  if (!playing || paused) return;
  cameraMode = (cameraMode + 1) % 3;
  profile.setPreferences({ camera: cameraMode });
  notify(["追尾镜头", "远景镜头", "引擎盖镜头"][cameraMode]);
}
$("touch-camera").onclick = cycleCamera;
$("touch-reset").onclick = () => {
  if (playing && !paused) reset();
};
$("home").addEventListener("click", (event) => {
  if (
    event.ctrlKey ||
    event.metaKey ||
    event.shiftKey ||
    event.altKey ||
    event.button > 0
  )
    return;
  event.preventDefault();
  if (playing) {
    if (!sessionSaved) finish();
    menu();
  } else $("start").focus({ preventScroll: true });
});
touchMedia.addEventListener("change", () => {
  if (!touchDevice()) {
    keys.releasePointers();
    syncInputButtons();
  }
  $("touch").classList.toggle("hidden", !touchDevice() || !playing || paused);
});
addEventListener("storage", (e) => {
  if (e.key !== PROFILE_KEY) return;
  profile.refresh();
  if (!playing) applyGaragePreferences();
  updateGarageRecord();
});
addEventListener("blur", () => {
  clearInput();
  if (playing && !paused) togglePause();
});
document.addEventListener("visibilitychange", () => {
  renderSchedule.invalidate();
  if (document.hidden && playing && !paused) togglePause();
});
function releasePointer(e) {
  const source = "pointer:" + e.pointerId;
  if (e.type === "lostpointercapture") keys.cancelHeld(source);
  else keys.release(source, e.type === "pointercancel");
  syncInputButtons();
}
// Window listeners also release input when pointer capture is unavailable.
for (const type of ["pointerup", "pointercancel"])
  addEventListener(type, releasePointer);
for (const b of inputButtons) {
  b.addEventListener("pointerdown", (e) => {
    if (!playing || paused || e.button > 0) return;
    e.preventDefault();
    try {
      b.setPointerCapture(e.pointerId);
    } catch {}
    keys.press("pointer:" + e.pointerId, b.dataset.key);
    syncInputButtons();
  });
  for (const ev of ["pointerup", "pointercancel", "lostpointercapture"])
    b.addEventListener(ev, releasePointer);
}
function controls() {
  return {
    throttle: keys.has("KeyW") || keys.has("ArrowUp"),
    reverse: keys.has("KeyS") || keys.has("ArrowDown"),
    steer:
      (keys.has("KeyA") || keys.has("ArrowLeft") ? 1 : 0) -
      (keys.has("KeyD") || keys.has("ArrowRight") ? 1 : 0),
    brake: keys.has("Space"),
    burnout: keys.has("KeyB"),
  };
}
function finish() {
  if (sessionSaved) return;
  score.bank();
  sessionSaved = true;
  dialogKind = "result";
  $("pause").disabled = true;
  $("quality").disabled = true;
  saveBest();
  const persistent = profile.recordSession({
    mode,
    score: score.total,
    at: Date.now(),
    duration: clock.elapsed,
    ...sessionStats,
    bestChain: Math.floor(sessionStats.bestChain),
    laps: laps.laps,
    bestLap: laps.best,
    completed: mode === "free" || clock.finished,
  });
  const best = profile.best(mode).score;
  const recordBadge =
    score.total > personalBestAtStart
      ? '<span class="record-badge">NEW PERSONAL BEST / 本模式新纪录</span>'
      : "";
  paused = true;
  audio.setActive(false);
  clearInput();
  $("touch").classList.add("hidden");
  dialog(
    mode === "challenge"
      ? "SESSION COMPLETE / 120 SEC"
      : "FREE RUN / SESSION COMPLETE",
    "山路记住了你。",
    `${recordBadge}<span class="eyebrow">TOTAL DRIFT POINTS</span><div class="result-score">${format(score.total)}</div><div class="result-grid"><div><span>驾驶时间</span><b>${formatLap(clock.elapsed)}</b></div><div><span>行驶距离</span><b>${(sessionStats.distance / 1000).toFixed(2)} km</b></div><div><span>最高速度</span><b>${Math.round(sessionStats.topSpeed * 3.6)} km/h</b></div><div><span>最佳连击</span><b>${Math.floor(sessionStats.bestChain).toLocaleString()}</b></div><div><span>完成圈数</span><b>${laps.laps}</b></div><div><span>最佳圈速</span><b>${formatLap(laps.best)}</b></div></div><p>本模式最高分 ${format(best)}<br><span class="save-status">${persistent ? "驾驶档案已保存到此浏览器" : "浏览器存储不可用，档案仅在本次打开时保留"}</span></p><button class="secondary" id="return-menu">返回车库</button>`,
    "再跑一次",
    start,
  );
  $("return-menu").onclick = menu;
}
function step(dt, elapsed) {
  sessionStats.bestChain = Math.max(sessionStats.bestChain, score.chain);
  const input = controls(),
    road = nearestRoad(carState.x, carState.z);
  if (keys.advance(dt)) syncInputButtons();
  stepCar(carState, input, dt, road, handlingMode);
  const after = nearestRoad(carState.x, carState.z);
  const announceImpact = carState.collisionCooldown === 0;
  if (resolveBarrier(carState, after, HALF_WIDTH)) {
    score.reset();
    if (announceImpact) notify("擦碰护栏 · 连击中断");
  }
  if (after.distance > HALF_WIDTH) carState.drifting = false;
  presentation.advance(carState, dt);
  drivetrain.update(carState, input, dt);
  score.update(carState, dt);
  sessionStats.bestChain = Math.max(sessionStats.bestChain, score.chain);
  sessionStats.distance += carState.speed * dt;
  sessionStats.topSpeed = Math.max(sessionStats.topSpeed, carState.speed);
  if (score.lastBank) {
    saveBest();
    notify(`+${score.lastBank.toLocaleString()} 漂移分数已入账`);
  }
  if (laps.observe(after.progress, elapsed)) {
    saveBest();
    notify(`LAP ${laps.laps} · ${formatLap(laps.last)}`, 3);
  }
}
const desired = new T.Vector3(),
  look = new T.Vector3(),
  smoothedLook = new T.Vector3();
function resetCamera() {
  const s = carState;
  camera.position.set(
    s.x - Math.sin(s.yaw) * 10,
    5.2,
    s.z - Math.cos(s.yaw) * 10,
  );
  smoothedLook.set(s.x, 1, s.z);
  camera.lookAt(smoothedLook);
}
function updateCamera(dt) {
  if (playing && paused) return;
  const s = renderState;
  if (!playing) {
    car.visible = true;
    if (!reducedMotion.matches) menuTime += dt;
    const angle =
      s.yaw +
      Math.PI * 0.8 +
      (reducedMotion.matches ? 0 : Math.sin(menuTime * 0.12) * 0.18);
    const portrait = innerWidth < 700;
    desired.set(
      s.x + Math.sin(angle) * (portrait ? 10 : 11.6),
      portrait ? 4.4 : 4.2,
      s.z + Math.cos(angle) * (portrait ? 10 : 11.6),
    );
    if (reducedMotion.matches) camera.position.copy(desired);
    else camera.position.lerp(desired, 1 - Math.exp(-dt * 2));
    look.set(
      s.x - (portrait ? 0 : Math.cos(s.yaw) * 2),
      0.8,
      s.z + (portrait ? 0 : Math.sin(s.yaw) * 2),
    );
    if (reducedMotion.matches) smoothedLook.copy(look);
    else smoothedLook.lerp(look, 1 - Math.exp(-dt * 2));
    camera.fov = portrait ? 57 : 48;
    camera.setViewOffset(
      innerWidth,
      innerHeight,
      innerWidth * (portrait ? -0.12 : -0.2),
      innerHeight * (portrait ? -0.08 : 0),
      innerWidth,
      innerHeight,
    );
  } else {
    camera.clearViewOffset();
    const distance = cameraMode === 1 ? 15 : cameraMode === 2 ? -0.9 : 9;
    const height = cameraMode === 1 ? 8 : cameraMode === 2 ? 1.18 : 4.4;
    const heading = drivingCameraHeading(s, cameraMode);
    car.visible = cameraMode !== 2;
    desired.set(
      s.x - Math.sin(heading) * distance,
      height,
      s.z - Math.cos(heading) * distance,
    );
    if (cameraMode === 2) camera.position.copy(desired);
    else camera.position.lerp(desired, 1 - Math.exp(-dt * 5));
    look.set(s.x + Math.sin(heading) * 7, 1, s.z + Math.cos(heading) * 7);
    if (cameraMode === 2) smoothedLook.copy(look);
    else smoothedLook.lerp(look, 1 - Math.exp(-dt * 9));
    camera.fov = T.MathUtils.lerp(
      camera.fov,
      60 + s.speed * 0.25,
      1 - Math.exp(-dt * 2),
    );
  }
  camera.lookAt(smoothedLook);
  camera.updateProjectionMatrix();
}
const drawMiniMap = createMinimap($("map"), samples);
let hudTime = 0;
function updateHUD(dt) {
  hudTime += dt;
  if (hudTime < 0.06) return;
  hudTime = 0;
  $("speed").textContent = Math.round(carState.speed * 3.6)
    .toString()
    .padStart(3, "0");
  $("gear").textContent =
    drivetrain.gear === 0
      ? "N"
      : drivetrain.gear < 0
        ? "R"
        : String(drivetrain.gear);
  $("rpm").style.width = (drivetrain.rpm / REDLINE_RPM) * 100 + "%";
  $("score").textContent = format(score.total);
  $("drift").classList.toggle("active", score.chain > 5);
  $("chain").textContent = "+" + Math.floor(score.chain).toLocaleString();
  $("multiplier").textContent = "×" + score.multiplier.toFixed(1);
  $("chain-life").style.width = clamp((score.grace / 1.6) * 100, 0, 100) + "%";
  $("drift-label").textContent =
    score.multiplier >= 3
      ? "UNSTOPPABLE"
      : score.multiplier >= 2
        ? "GREAT DRIFT"
        : "DRIFT";
  const feedback = drivingFeedback(
    carState,
    nearestRoad(carState.x, carState.z).distance > HALF_WIDTH,
  );
  $("grip").textContent = feedback.status;
  $("slip-angle").textContent = feedback.angle;
  $("driving-hint").textContent = feedback.hint;
  for (const name of ["throttle", "brake"]) {
    const value = feedback[name] * 100;
    $(name + "-input").style.width = value + "%";
    $(name + "-input").setAttribute("aria-valuenow", String(Math.round(value)));
  }
  $("lap-number").textContent = String(laps.laps + 1).padStart(2, "0");
  $("lap-time").textContent = formatLap(laps.current(clock.elapsed));
  $("lap-best").textContent = formatLap(profile.best(mode).bestLap);
  $("lap-status").textContent = laps.valid
    ? "CURRENT LAP"
    : "OUT LAP / 过线计时";
  const sec = Math.ceil(clock.remaining);
  $("timer").textContent =
    String(Math.floor(sec / 60)).padStart(2, "0") +
    ":" +
    String(sec % 60).padStart(2, "0");
  $("timer").style.color = clock.remaining < 15 ? "#ff8166" : "";
  drawMiniMap(carState);
}
function frame(now) {
  requestAnimationFrame(frame);
  if (document.hidden) {
    last = now;
    renderSchedule.invalidate();
    return;
  }
  const elapsed = Math.max(0, (now - last) / 1000);
  const dt = Math.min(elapsed, 0.25);
  let simulated = false;
  last = now;
  if (noticeUntil > 0 && now >= noticeUntil) {
    $("notice").textContent = "";
    noticeUntil = 0;
  }
  if (playing && !paused) {
    if (quality.sample(elapsed)) {
      renderer.setPixelRatio(quality.ratio);
      renderSchedule.invalidate();
    }
    const activeTime = clock.advance(elapsed);
    const catchUp = Math.min(activeTime, 0.25);
    // Timestamp each completed physics tick inside the active frame, including
    // the carried fraction. Stalls retain wall time but only simulate the last
    // bounded catch-up window; crossings must not all inherit the frame end.
    let simulatedAt = clock.elapsed - catchUp - accumulator;
    accumulator += catchUp;
    let count = 0;
    while (accumulator >= 1 / 120 && count++ < 30) {
      simulatedAt += 1 / 120;
      step(1 / 120, simulatedAt);
      simulated = true;
      accumulator -= 1 / 120;
      if (paused) {
        accumulator = 0;
        break;
      }
    }
    if (clock.finished) finish();
  } else accumulator = 0;
  if (simulated || (playing && !paused))
    presentation.sample(accumulator * 120, renderState);
  else if (!playing) presentation.sample(1, renderState);
  car.position.set(renderState.x, 0, renderState.z);
  car.rotation.y = renderState.yaw;
  groundEffects.position.copy(car.position);
  groundEffects.rotation.y = renderState.yaw;
  car.rotation.z = playing ? renderState.roll : 0;
  car.rotation.x = playing ? renderState.pitch : 0;
  for (const wheel of wheels) {
    wheel.rotation.x =
      wheel.position.z > 0
        ? renderState.frontWheelSpin
        : renderState.rearWheelSpin;
    if (wheel.position.z > 0) wheel.rotation.y = renderState.steerAngle;
  }
  setBrake(
    playing &&
      (keys.has("Space") ||
        keys.has("KeyS") ||
        keys.has("ArrowDown") ||
        keys.has("KeyB")),
  );
  updateEffects(
    renderState,
    paused ? 0 : dt,
    playing && !paused && (carState.drifting || carState.tireSmoke > 0.12),
  );
  updateCamera(dt);
  if (playing) updateHUD(dt);
  audio.update(drivetrain, carState.tireSmoke, playing && !paused);
  if (
    renderSchedule.shouldRender(now, {
      active: playing && !paused,
      hidden: document.hidden,
      reducedMotion: !playing && reducedMotion.matches,
    })
  ) {
    renderer.render(scene, camera);
    renderedFrames++;
    if (!sceneReady) {
      sceneReady = true;
      $("loading").classList.add("hidden");
    }
  }
}
function resizeRenderer() {
  renderer.setPixelRatio(
    quality.resize({
      width: innerWidth,
      height: innerHeight,
      dpr: devicePixelRatio,
    }),
  );
  renderSchedule.invalidate();
  renderer.setSize(innerWidth, innerHeight);
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
}
addEventListener("resize", resizeRenderer);
$("world").addEventListener("webglcontextlost", (event) => {
  event.preventDefault();
  contextLost = true;
  if (playing && !paused) togglePause();
  $("start").disabled = true;
  $("dialog-action").disabled = true;
});
$("world").addEventListener("webglcontextrestored", () => {
  contextLost = false;
  renderSchedule.invalidate();
  $("start").disabled = false;
  $("dialog-action").disabled = false;
  notify("3D 场景已恢复，可以继续驾驶", 4);
});
resetCamera();
requestAnimationFrame(frame);
// Small read-only diagnostics surface for repeatable browser QA.
window.__DRIFT__ = {
  get state() {
    return {
      playing,
      paused,
      mode,
      remaining: clock.remaining,
      score: score.total,
      chain: score.chain,
      laps: laps.laps,
      bestLap: laps.best,
      elapsed: clock.elapsed,
      stats: { ...sessionStats },
      car: { ...carState },
      engine: {
        gear: drivetrain.gear,
        rpm: drivetrain.rpm,
        load: drivetrain.load,
      },
      drawCalls: renderer.info.render.calls,
      renderedFrames,
      resolution: quality.ratio,
      quality: quality.mode,
      handling: handlingMode,
    };
  },
};
