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
const keys = new Set();
let playing = false,
  paused = false,
  mode = "free",
  cameraMode = 0,
  remaining = 120,
  score = new DriftScore(),
  carState,
  menuTime = 0,
  last = 0,
  accumulator = 0,
  noticeUntil = 0,
  lap = 0,
  checkpoint = 0;
let best = 0;
try {
  best = Number(localStorage.getItem("midnight-best")) || 0;
} catch {}
const format = (n) => Math.floor(n).toString().padStart(6, "0");
$("menu-best").textContent = format(best);
const p = spawn();
carState = createCarState(p.x, p.z, p.yaw);
car.position.set(p.x, 0, p.z);
car.rotation.y = p.yaw;
const touchDevice = matchMedia("(pointer: coarse)").matches;
let onDialog = () => {};
function dialog(kicker, title, body, action, callback) {
  $("dialog-kicker").textContent = kicker;
  $("dialog-title").textContent = title;
  $("dialog-body").innerHTML = body;
  $("dialog-action").innerHTML = action + "<span>↗</span>";
  $("overlay").classList.remove("hidden");
  onDialog = callback;
}
$("dialog-action").onclick = () => {
  $("overlay").classList.add("hidden");
  onDialog();
};
function showHelp() {
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
  clearInput();
  playing = true;
  paused = false;
  remaining = 120;
  score = new DriftScore();
  lap = 0;
  checkpoint = 0;
  const s = spawn();
  carState = createCarState(s.x, s.z, s.yaw);
  document.body.classList.add("playing");
  $("hud").classList.remove("hidden");
  $("overlay").classList.add("hidden");
  $("timer").classList.toggle("hidden", mode !== "challenge");
  $("session-mode").textContent =
    mode === "free" ? "FREE RUN / 自由漂移" : "TIME ATTACK / 限时挑战";
  if (touchDevice) $("touch").classList.remove("hidden");
  resetCamera();
  notify("保持油门，前往第一个弯道", 4);
}
$("start").onclick = start;
function menu() {
  score.bank();
  saveBest();
  playing = false;
  paused = false;
  clearInput();
  document.body.classList.remove("playing");
  $("hud").classList.add("hidden");
  $("touch").classList.add("hidden");
  $("overlay").classList.add("hidden");
}
function togglePause() {
  if (!playing || remaining <= 0) return;
  if (paused) {
    paused = false;
    $("overlay").classList.add("hidden");
    return;
  }
  paused = true;
  clearInput();
  dialog(
    "TAKE A BREATHER",
    "暂停，夜还很长。",
    '<p>你的漂移记录已保留。准备好后，继续征服弯道。</p><button class="secondary" id="return-menu">结束本次驾驶 / 返回车库</button>',
    "继续驾驶",
    () => {
      paused = false;
    },
  );
  $("return-menu").onclick = menu;
}
$("pause").onclick = togglePause;
$("sound").onclick = async () => {
  try {
    const enabled = await audio.toggle();
    $("sound").innerHTML = enabled ? "♪" : '♪<span class="off-slash">／</span>';
    $("sound").setAttribute("aria-label", enabled ? "关闭声音" : "开启声音");
  } catch {
    notify("浏览器暂时无法播放音频");
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
  resetCamera();
  notify("已返回赛道 · 当前连击已清空");
}
addEventListener("keydown", (e) => {
  if (
    ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Space"].includes(
      e.code,
    )
  )
    e.preventDefault();
  if (e.repeat) return;
  if (e.code === "Escape") {
    if (!$("overlay").classList.contains("hidden") && !paused) {
      $("overlay").classList.add("hidden");
      return;
    }
    togglePause();
    return;
  }
  if (
    e.code === "Enter" &&
    !playing &&
    $("overlay").classList.contains("hidden")
  )
    start();
  if (playing && !paused) {
    if (e.code === "KeyR") reset();
    if (e.code === "KeyC") {
      cameraMode = (cameraMode + 1) % 3;
      notify(["追尾镜头", "远景镜头", "引擎盖镜头"][cameraMode]);
    }
    keys.add(e.code);
  }
});
addEventListener("keyup", (e) => keys.delete(e.code));
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
    keys.add(b.dataset.key);
    b.classList.add("pressed");
  });
  for (const ev of ["pointerup", "pointercancel", "lostpointercapture"])
    b.addEventListener(ev, () => {
      keys.delete(b.dataset.key);
      b.classList.remove("pressed");
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
  saveBest();
  paused = true;
  clearInput();
  $("touch").classList.add("hidden");
  dialog(
    "SESSION COMPLETE / 120 SEC",
    "山路记住了你。",
    `<span class="eyebrow">TOTAL DRIFT POINTS</span><div class="result-score">${format(score.total)}</div><p>个人最佳 ${format(best)}<br>每一次反打，都是下一次完美漂移的开始。</p><button class="secondary" id="return-menu">返回车库</button>`,
    "再跑一次",
    start,
  );
  $("return-menu").onclick = menu;
}
function step(dt) {
  const input = controls(),
    road = nearestRoad(carState.x, carState.z);
  stepCar(carState, input, dt, road);
  const after = nearestRoad(carState.x, carState.z);
  if (resolveBarrier(carState, after, HALF_WIDTH)) {
    score.reset();
    notify("擦碰护栏 · 连击中断");
  }
  score.update(carState, dt);
  if (score.lastBank) {
    saveBest();
    notify(`+${score.lastBank.toLocaleString()} 漂移分数已入账`);
  }
  if (mode === "challenge") {
    remaining = Math.max(0, remaining - dt);
    if (remaining === 0) finish();
  }
  // Four ordered sectors prevent farming laps by reversing across the start line.
  const sector = Math.floor((after.index / samples.length) * 4);
  if (sector === (checkpoint + 1) % 4) {
    checkpoint = sector;
    if (sector === 0) {
      lap++;
      notify(`LAP ${lap} · 继续保持节奏`);
    }
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
    const height = cameraMode === 1 ? 8 : cameraMode === 2 ? 1.35 : 4.4;
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
  const sec = Math.ceil(remaining);
  $("timer").textContent =
    String(Math.floor(sec / 60)).padStart(2, "0") +
    ":" +
    String(sec % 60).padStart(2, "0");
  $("timer").style.color = remaining < 15 ? "#ff8166" : "";
  if (performance.now() > noticeUntil) $("notice").textContent = "";
  drawMap();
}
function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min((now - last) / 1000 || 0.016, 0.08);
  last = now;
  if (playing && !paused) {
    accumulator += dt;
    let count = 0;
    while (accumulator >= 1 / 120 && count++ < 12) {
      step(1 / 120);
      accumulator -= 1 / 120;
      if (paused) {
        accumulator = 0;
        break;
      }
    }
  } else accumulator = 0;
  car.position.set(carState.x, 0, carState.z);
  car.rotation.y = carState.yaw;
  car.rotation.z = T.MathUtils.lerp(
    car.rotation.z,
    -carState.steer * carState.speed * 0.0009,
    dt * 5,
  );
  for (const wheel of wheels) {
    wheel.rotation.x += playing && !paused ? (carState.speed * dt) / 0.37 : 0;
    if (wheel.position.z > 0) wheel.rotation.y = carState.steer * 0.35;
  }
  setBrake(playing && (keys.has("Space") || keys.has("KeyS")));
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
      remaining,
      score: score.total,
      chain: score.chain,
      car: { ...carState },
      drawCalls: renderer.info.render.calls,
    };
  },
};
