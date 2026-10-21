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
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.7));
renderer.setSize(innerWidth, innerHeight);
renderer.outputColorSpace = T.SRGBColorSpace;
renderer.toneMapping = T.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.25;
const camera = new T.PerspectiveCamera(48, innerWidth / innerHeight, 0.1, 1800);
const audio = new EngineAudio();
const keys = new InputState();
const clock = new SessionClock();
let playing = false,
  paused = false,
  mode = "free",
  cameraMode = 0,
  score = new DriftScore(),
  carState,
  menuTime = 0,
  last = 0,
  accumulator = 0,
  noticeUntil = 0,
  laps,
  sessionStats,
  contextLost = false;
let best = 0;
try {
  const stored = Number(localStorage.getItem("midnight-best"));
  best = Number.isSafeInteger(stored) && stored >= 0 ? stored : 0;
} catch {}
const format = (n) => Math.floor(n).toString().padStart(6, "0");
$("menu-best").textContent = format(best);
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
    '<div class="control-row"><span>油门 / 刹车与倒车</span><span><kbd>W / ↑</kbd><kbd>S / ↓</kbd></span></div><div class="control-row"><span>转向</span><span><kbd>A / ←</kbd><kbd>D / →</kbd></span></div><div class="control-row"><span>手刹 / 甩尾</span><kbd>SPACE</kbd></div><div class="control-row"><span>切换镜头 / 重置车辆</span><span><kbd>C</kbd><kbd>R</kbd></span></div><p>先加速到 50 km/h 以上，入弯时转向并轻点手刹。松开手刹，用反打修正车头。连续漂移提高倍率，回正 1.6 秒后结算。撞护栏会失去当前连击。</p><p>触屏设备使用屏幕底部的驾驶按钮。</p>',
    "准备好了",
    () => {},
  );
}
$("help").onclick = showHelp;
function clearInput() {
  keys.clear();
  document
    .querySelectorAll("[data-key]")
    .forEach((b) => b.classList.remove("pressed"));
}
function saveBest() {
  if (score.total > best) {
    best = score.total;
    try {
      localStorage.setItem("midnight-best", String(best));
    } catch {}
    $("menu-best").textContent = format(best);
  }
}
function start() {
  if (contextLost) return;
  clearInput();
  playing = true;
  paused = false;
  audio.setActive(true);
  clock.reset(mode);
  accumulator = 0;
  last = performance.now();
  resetEffects();
  wheels.forEach((wheel) => wheel.rotation.set(0, 0, 0));
  car.rotation.z = 0;
  score = new DriftScore();
  const s = spawn();
  carState = createCarState(s.x, s.z, s.yaw);
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
    document
      .querySelectorAll("[data-mode]")
      .forEach((x) => x.classList.toggle("selected", x === b));
  };
for (const b of document.querySelectorAll("[data-color]"))
  b.onclick = () => {
    paint.color.set(b.dataset.color);
    document
      .querySelectorAll("[data-color]")
      .forEach((x) => x.classList.toggle("active", x === b));
  };
function notify(text, duration = 2) {
  $("notice").textContent = text;
  noticeUntil = performance.now() + duration * 1000;
}
function reset() {
  const near = nearestRoad(carState.x, carState.z),
    t = tangents[near.index];
  carState = createCarState(near.x, near.z, Math.atan2(t.x, t.z));
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
      if (dialogKind === "help") closeDialog();
      else if (dialogKind === "pause") resume();
    }
    if (e.code === "Tab") {
      const buttons = [
        ...$("overlay").querySelectorAll("button:not(:disabled)"),
      ];
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
});
addEventListener("keyup", (e) => keys.release("key:" + e.code));
function cycleCamera() {
  if (!playing || paused) return;
  cameraMode = (cameraMode + 1) % 3;
  notify(["追尾镜头", "远景镜头", "引擎盖镜头"][cameraMode]);
}
$("touch-camera").onclick = cycleCamera;
$("touch-reset").onclick = () => {
  if (playing && !paused) reset();
};
touchMedia.addEventListener("change", () =>
  $("touch").classList.toggle("hidden", !touchDevice() || !playing || paused),
);
addEventListener("blur", () => {
  clearInput();
  if (playing && !paused) togglePause();
});
document.addEventListener("visibilitychange", () => {
  if (document.hidden && playing && !paused) togglePause();
});
for (const b of document.querySelectorAll("[data-key]")) {
  b.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    if (!playing || paused) return;
    b.setPointerCapture(e.pointerId);
    keys.press("pointer:" + e.pointerId, b.dataset.key);
    b.classList.add("pressed");
  });
  for (const ev of ["pointerup", "pointercancel", "lostpointercapture"])
    b.addEventListener(ev, (e) => {
      keys.release("pointer:" + e.pointerId);
      b.classList.toggle("pressed", keys.has(b.dataset.key));
    });
}
function controls() {
  return {
    throttle: keys.has("KeyW") || keys.has("ArrowUp"),
    reverse: keys.has("KeyS") || keys.has("ArrowDown"),
    steer:
      (keys.has("KeyA") || keys.has("ArrowLeft") ? 1 : 0) -
      (keys.has("KeyD") || keys.has("ArrowRight") ? 1 : 0),
    brake: keys.has("Space"),
  };
}
function finish() {
  score.bank();
  dialogKind = "result";
  $("pause").disabled = true;
  saveBest();
  paused = true;
  audio.setActive(false);
  clearInput();
  $("touch").classList.add("hidden");
  dialog(
    mode === "challenge"
      ? "SESSION COMPLETE / 120 SEC"
      : "FREE RUN / SESSION COMPLETE",
    "山路记住了你。",
    `<span class="eyebrow">TOTAL DRIFT POINTS</span><div class="result-score">${format(score.total)}</div><div class="result-grid"><div><span>驾驶时间</span><b>${formatLap(clock.elapsed)}</b></div><div><span>行驶距离</span><b>${(sessionStats.distance / 1000).toFixed(2)} km</b></div><div><span>最高速度</span><b>${Math.round(sessionStats.topSpeed * 3.6)} km/h</b></div><div><span>最佳连击</span><b>${Math.floor(sessionStats.bestChain).toLocaleString()}</b></div><div><span>完成圈数</span><b>${laps.laps}</b></div><div><span>最佳圈速</span><b>${formatLap(laps.best)}</b></div></div><p>个人最佳 ${format(best)}</p><button class="secondary" id="return-menu">返回车库</button>`,
    "再跑一次",
    start,
  );
  $("return-menu").onclick = menu;
}
function step(dt) {
  sessionStats.bestChain = Math.max(sessionStats.bestChain, score.chain);
  const input = controls(),
    road = nearestRoad(carState.x, carState.z);
  stepCar(carState, input, dt, road);
  const after = nearestRoad(carState.x, carState.z);
  const announceImpact = carState.collisionCooldown === 0;
  if (resolveBarrier(carState, after, HALF_WIDTH)) {
    score.reset();
    if (announceImpact) notify("擦碰护栏 · 连击中断");
  }
  if (after.distance > HALF_WIDTH) carState.drifting = false;
  score.update(carState, dt);
  sessionStats.bestChain = Math.max(sessionStats.bestChain, score.chain);
  sessionStats.distance += carState.speed * dt;
  sessionStats.topSpeed = Math.max(sessionStats.topSpeed, carState.speed);
  if (score.lastBank) {
    saveBest();
    notify(`+${score.lastBank.toLocaleString()} 漂移分数已入账`);
  }
  if (laps.observe(after.progress, clock.elapsed)) {
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
    menuTime += dt;
    const angle = s.yaw + Math.PI * 0.8 + Math.sin(menuTime * 0.12) * 0.18;
    const portrait = innerWidth < 700;
    desired.set(
      s.x + Math.sin(angle) * (portrait ? 10 : 11.6),
      portrait ? 4.4 : 4.2,
      s.z + Math.cos(angle) * (portrait ? 10 : 11.6),
    );
    camera.position.lerp(desired, 1 - Math.exp(-dt * 2));
    look.set(
      s.x - (portrait ? 0 : Math.cos(s.yaw) * 2),
      0.8,
      s.z + (portrait ? 0 : Math.sin(s.yaw) * 2),
    );
    smoothedLook.lerp(look, 1 - Math.exp(-dt * 2));
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
    car.visible = cameraMode !== 2;
    desired.set(
      s.x - Math.sin(s.yaw) * distance,
      height,
      s.z - Math.cos(s.yaw) * distance,
    );
    camera.position.lerp(
      desired,
      1 - Math.exp(-dt * (cameraMode === 2 ? 24 : 5)),
    );
    look.set(s.x + Math.sin(s.yaw) * 7, 1, s.z + Math.cos(s.yaw) * 7);
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
const map = $("map"),
  ctx = map.getContext("2d");
function drawMap() {
  ctx.clearRect(0, 0, 240, 200);
  const mx = (x) => 120 + x * 0.65,
    mz = (z) => 94 + z * 0.65;
  ctx.beginPath();
  samples.forEach((p, i) =>
    i ? ctx.lineTo(mx(p.x), mz(p.z)) : ctx.moveTo(mx(p.x), mz(p.z)),
  );
  ctx.closePath();
  ctx.strokeStyle = "#091119bb";
  ctx.lineWidth = 12;
  ctx.stroke();
  ctx.strokeStyle = "#758b8477";
  ctx.lineWidth = 5;
  ctx.stroke();
  ctx.strokeStyle = "#c5e3a055";
  ctx.lineWidth = 1;
  ctx.stroke();
  const start = samples[0];
  ctx.fillStyle = "#f0f7e0";
  ctx.fillRect(mx(start.x) - 3, mz(start.z) - 3, 6, 6);
  ctx.save();
  ctx.translate(mx(carState.x), mz(carState.z));
  ctx.rotate(-carState.yaw);
  ctx.beginPath();
  ctx.moveTo(0, 7);
  ctx.lineTo(-4, -4);
  ctx.lineTo(4, -4);
  ctx.closePath();
  ctx.fillStyle = "#b8ed50";
  ctx.shadowColor = "#b8ed50";
  ctx.shadowBlur = 10;
  ctx.fill();
  ctx.restore();
}
let hudTime = 0;
function updateHUD(dt) {
  hudTime += dt;
  if (hudTime < 0.06) return;
  hudTime = 0;
  $("speed").textContent = Math.round(carState.speed * 3.6)
    .toString()
    .padStart(3, "0");
  const forward =
    carState.vx * Math.sin(carState.yaw) + carState.vz * Math.cos(carState.yaw);
  $("gear").textContent =
    carState.speed < 0.8
      ? "N"
      : forward < -0.5
        ? "R"
        : Math.min(6, Math.floor(carState.speed / 11) + 1);
  $("rpm").style.width =
    (carState.speed < 0.8 ? 6 : 35 + ((carState.speed % 11) / 11) * 65) + "%";
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
  $("grip").textContent = carState.drifting
    ? "SLIDING"
    : nearestRoad(carState.x, carState.z).distance > HALF_WIDTH
      ? "OFF ROAD"
      : "GRIP";
  $("lap-number").textContent = String(laps.laps + 1).padStart(2, "0");
  $("lap-time").textContent = formatLap(laps.current(clock.elapsed));
  $("lap-best").textContent = formatLap(laps.best);
  $("lap-status").textContent = laps.valid
    ? "CURRENT LAP"
    : "OUT LAP / 过线计时";
  const sec = Math.ceil(clock.remaining);
  $("timer").textContent =
    String(Math.floor(sec / 60)).padStart(2, "0") +
    ":" +
    String(sec % 60).padStart(2, "0");
  $("timer").style.color = clock.remaining < 15 ? "#ff8166" : "";
  drawMap();
}
function frame(now) {
  requestAnimationFrame(frame);
  const elapsed = Math.max(0, (now - last) / 1000);
  const dt = Math.min(elapsed, 0.08);
  last = now;
  if (noticeUntil > 0 && now >= noticeUntil) {
    $("notice").textContent = "";
    noticeUntil = 0;
  }
  if (playing && !paused) {
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
    -carState.steer * carState.speed * 0.0009,
    dt * 5,
  );
  const signedSpeed =
    carState.vx * Math.sin(carState.yaw) + carState.vz * Math.cos(carState.yaw);
  for (const wheel of wheels) {
    wheel.rotation.x += playing && !paused ? (signedSpeed * dt) / 0.37 : 0;
    if (wheel.position.z > 0) wheel.rotation.y = carState.steer * 0.35;
  }
  setBrake(
    playing && (keys.has("Space") || keys.has("KeyS") || keys.has("ArrowDown")),
  );
  updateEffects(
    carState,
    paused ? 0 : dt,
    playing && !paused && carState.drifting,
  );
  updateCamera(dt);
  if (playing) updateHUD(dt);
  audio.update(
    carState.speed,
    keys.has("KeyW") || keys.has("ArrowUp"),
    carState.drifting,
    playing && !paused,
  );
  renderer.render(scene, camera);
}
addEventListener("resize", () => {
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
  $("start").disabled = false;
  $("dialog-action").disabled = false;
  notify("3D 场景已恢复，可以继续驾驶", 4);
});
resetCamera();
requestAnimationFrame(frame);
$("loading").classList.add("hidden");
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
      drawCalls: renderer.info.render.calls,
    };
  },
};
