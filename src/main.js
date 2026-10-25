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
paint.color.set(preferences.color);
for (const button of document.querySelectorAll("[data-color]")) {
  const selected = button.dataset.color === preferences.color;
  button.classList.toggle("active", selected);
  button.setAttribute("aria-pressed", String(selected));
}
for (const button of document.querySelectorAll("[data-mode]")) {
  const selected = button.dataset.mode === mode;
  button.classList.toggle("selected", selected);
  button.setAttribute("aria-pressed", String(selected));
}
const p = spawn();
carState = createCarState(p.x, p.z, p.yaw);
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
    '<div class="control-row"><span>油门 / 刹车与倒车</span><span><kbd>W / ↑</kbd><kbd>S / ↓</kbd></span></div><div class="control-row"><span>转向</span><span><kbd>A / ←</kbd><kbd>D / →</kbd></span></div><div class="control-row"><span>手刹 / 甩尾</span><kbd>SPACE</kbd></div><div class="control-row"><span>切换镜头 / 重置车辆</span><span><kbd>C</kbd><kbd>R</kbd></span></div><p>入弯前减速，转向后短按手刹。松开手刹，及时向车尾滑出的方向反打。保持油门可以维持漂移，松开方向也能接住侧滑；左右方向调整漂移方向，反打可切换甩尾。松开油门与方向，后轮逐步恢复抓地并收车。长按手刹会锁住后轮并损失速度。连续漂移提高倍率，回正 1.6 秒后结算。撞护栏会失去当前连击。</p><p>按住 B（或低速时 W+S）原地烧胎：前轮制动、后轮空转。松开即可结束，按住 Space 会锁住后轮。触屏设备使用屏幕底部的驾驶按钮。</p>',
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
  $("quality").setAttribute(
    "aria-label",
    `画质设置：${qualityLabels[quality.mode]}`,
  );
  $("quality").title = `画质：${qualityLabels[quality.mode]}`;
}
function showQuality() {
  const resumeAfter = playing && !paused;
  if (resumeAfter) togglePause();
  dialogKind = "quality";
  dialog(
    "FIND YOUR FLOW / 画质设置",
    "让每个弯道更顺畅。",
    "<p>自动适应设备表现，或选择你偏好的清晰度。切换立即生效。</p>",
    resumeAfter ? "继续驾驶" : "完成",
    () => {
      if (resumeAfter) resume();
    },
  );
  $("quality-options").classList.remove("hidden");
  updateQualityControls();
}
$("quality").onclick = showQuality;
for (const button of document.querySelectorAll("[data-quality]"))
  button.onclick = () => {
    quality.setMode(button.dataset.quality);
    profile.setPreferences({ quality: quality.mode });
    renderer.setPixelRatio(quality.ratio);
    renderSchedule.invalidate();
    updateQualityControls();
  };
updateQualityControls();
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
  clearInput();
  sessionSaved = false;
  personalBestAtStart = profile.best(mode).score;
  playing = true;
  paused = false;
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
  drivetrain.reset();
  laps = new LapTracker(nearestRoad(s.x, s.z).progress);
  sessionStats = { distance: 0, topSpeed: 0, bestChain: 0 };
  document.body.classList.add("playing");
  $("hud").classList.remove("hidden");
  $("overlay").classList.add("hidden");
  $("timer").classList.toggle("hidden", mode !== "challenge");
  $("session-mode").textContent =
    mode === "free" ? "FREE RUN / 自由漂移" : "TIME ATTACK / 限时挑战";
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
  car.rotation.x = 0;
  car.rotation.z = 0;
  drivetrain.reset();
  score.reset();
  laps.reanchor(near.progress, clock.elapsed);
  resetCamera();
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
  keys.release("pointer:" + e.pointerId, e.type === "pointercancel");
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
function step(dt) {
  sessionStats.bestChain = Math.max(sessionStats.bestChain, score.chain);
  const input = controls(),
    road = nearestRoad(carState.x, carState.z);
  if (keys.advance(dt)) syncInputButtons();
  stepCar(carState, input, dt, road);
  const after = nearestRoad(carState.x, carState.z);
  const announceImpact = carState.collisionCooldown === 0;
  if (resolveBarrier(carState, after, HALF_WIDTH)) {
    score.reset();
    if (announceImpact) notify("擦碰护栏 · 连击中断");
  }
  if (after.distance > HALF_WIDTH) carState.drifting = false;
  drivetrain.update(carState, input, dt);
  score.update(carState, dt);
  sessionStats.bestChain = Math.max(sessionStats.bestChain, score.chain);
  sessionStats.distance += carState.speed * dt;
  sessionStats.topSpeed = Math.max(sessionStats.topSpeed, carState.speed);
  if (score.lastBank) {
    saveBest();
    notify(`+${score.lastBank.toLocaleString()} 漂移分数已入账`);
  }
  if (laps.observe(after.progress, clock.elapsed)) {
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
  const s = carState;
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
    camera.position.lerp(
      desired,
      1 - Math.exp(-dt * (cameraMode === 2 ? 24 : 5)),
    );
    look.set(s.x + Math.sin(heading) * 7, 1, s.z + Math.cos(heading) * 7);
    smoothedLook.lerp(look, 1 - Math.exp(-dt * 9));
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
  $("grip").textContent = carState.burningOut
    ? "BURNOUT"
    : carState.drifting
      ? "SLIDING"
      : nearestRoad(carState.x, carState.z).distance > HALF_WIDTH
        ? "OFF ROAD"
        : "GRIP";
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
  const dt = Math.min(elapsed, 0.08);
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
    accumulator += Math.min(activeTime, 0.25);
    let count = 0;
    while (accumulator >= 1 / 120 && count++ < 30) {
      step(1 / 120);
      accumulator -= 1 / 120;
      if (paused) {
        accumulator = 0;
        break;
      }
    }
    if (clock.finished) finish();
  } else accumulator = 0;
  car.position.set(carState.x, 0, carState.z);
  car.rotation.y = carState.yaw;
  groundEffects.position.copy(car.position);
  groundEffects.rotation.y = carState.yaw;
  car.rotation.z = T.MathUtils.lerp(
    car.rotation.z,
    playing ? carState.roll : 0,
    dt * 5,
  );
  car.rotation.x = T.MathUtils.lerp(
    car.rotation.x,
    playing ? carState.pitch : 0,
    dt * 5,
  );
  const signedSpeed =
    carState.vx * Math.sin(carState.yaw) + carState.vz * Math.cos(carState.yaw);
  for (const wheel of wheels) {
    wheel.rotation.x +=
      playing && !paused
        ? (wheel.position.z > 0
            ? signedSpeed / 0.37
            : carState.rearWheelSpeed) * dt
        : 0;
    if (wheel.position.z > 0) wheel.rotation.y = carState.steerAngle;
  }
  setBrake(
    playing &&
      (keys.has("Space") ||
        keys.has("KeyS") ||
        keys.has("ArrowDown") ||
        keys.has("KeyB")),
  );
  updateEffects(
    carState,
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
addEventListener("resize", () => {
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
});
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
    };
  },
};
