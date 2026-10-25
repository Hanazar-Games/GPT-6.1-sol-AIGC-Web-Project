import * as T from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { createRoadQuery } from "./road-query.js";
export const HALF_WIDTH = 10;
export const scene = new T.Scene();
scene.background = new T.Color("#111d2c");
scene.fog = new T.FogExp2("#111d2c", 0.0034);
scene.add(new T.HemisphereLight("#9fb8d9", "#26312b", 2.1));
const moonlight = new T.DirectionalLight("#c7dfff", 2.3);
moonlight.position.set(-100, 150, 70);
scene.add(moonlight);
const warmLight = new T.DirectionalLight("#b8ed50", 0.7);
warmLight.position.set(60, 40, -80);
scene.add(warmLight);
const material = (color, roughness = 0.7, metalness = 0) =>
  new T.MeshStandardMaterial({ color, roughness, metalness });
const asphalt = material("#26323c", 0.94),
  verge = material("#333e3f"),
  rail = material("#56666b", 0.38, 0.6);
const lime = new T.MeshBasicMaterial({ color: "#b8ed50" }),
  white = new T.MeshBasicMaterial({ color: "#b6c4be" });
const dark = material("#10161d"),
  glass = material("#162c3a", 0.15, 0.65);
export const paint = material("#b8ed50", 0.28, 0.38);
const curve = new T.CatmullRomCurve3(
  [
    [-70, -100],
    [-15, -120],
    [65, -100],
    [105, -40],
    [95, 22],
    [40, 65],
    [5, 120],
    [-65, 130],
    [-115, 85],
    [-105, 30],
    [-55, 0],
    [-95, -50],
  ].map(([x, z]) => new T.Vector3(x, 0, z)),
  true,
  "catmullrom",
  0.5,
);
export const samples = curve.getSpacedPoints(900).slice(0, -1);
export const tangents = samples.map((p, i) =>
  samples[(i + 1) % samples.length]
    .clone()
    .sub(samples[(i - 1 + samples.length) % samples.length])
    .normalize(),
);
export const nearestRoad = createRoadQuery(samples, HALF_WIDTH);
function ribbon(offset, width, mat, y = 0.02) {
  const positions = [],
    indices = [];
  samples.forEach((p, i) => {
    const t = tangents[i],
      nx = t.z,
      nz = -t.x;
    for (const side of [-1, 1])
      positions.push(
        p.x + nx * (offset + (side * width) / 2),
        y,
        p.z + nz * (offset + (side * width) / 2),
      );
  });
  for (let i = 0; i < samples.length; i++) {
    const j = (i + 1) % samples.length;
    indices.push(i * 2, i * 2 + 1, j * 2, i * 2 + 1, j * 2 + 1, j * 2);
  }
  const g = new T.BufferGeometry();
  g.setAttribute("position", new T.Float32BufferAttribute(positions, 3));
  g.setIndex(indices);
  g.computeVertexNormals();
  // The road must remain visible from above regardless of spline winding.
  mat.side = T.DoubleSide;
  const m = new T.Mesh(g, mat);
  scene.add(m);
  return m;
}
ribbon(0, 28, verge, 0);
ribbon(0, 20, asphalt, 0.03);
for (const side of [-1, 1]) {
  ribbon(side * 9.6, 0.13, white, 0.045);
  ribbon(side * 12.9, 0.18, lime, 0.72);
  ribbon(side * 13, 0.24, rail, 0.55);
  ribbon(side * 13, 0.18, rail, 1.05);
}
function box(w, h, d, mat, x = 0, y = 0, z = 0, parent = scene) {
  const m = new T.Mesh(new T.BoxGeometry(w, h, d), mat);
  m.position.set(x, y, z);
  parent.add(m);
  return m;
}
for (let i = 0; i < samples.length; i += 5) {
  const p = samples[i],
    t = tangents[i];
  if (i % 15 === 0) {
    const m = box(0.13, 0.02, 2.4, white, p.x, 0.06, p.z);
    m.rotation.y = Math.atan2(t.x, t.z);
  }
  for (const s of [-1, 1]) {
    const x = p.x + t.z * s * 13,
      z = p.z - t.x * s * 13;
    box(0.12, 1.1, 0.12, rail, x, 0.55, z);
    if (i % 15 === 0) {
      const m = box(0.35, 0.18, 0.08, lime, x, 0.8, z);
      m.rotation.y = Math.atan2(t.x, t.z);
    }
  }
}
// Alternating curbs follow the actual spline.
const curbA = material("#b3c7b3"),
  curbB = material("#526761");
for (let i = 0; i < samples.length; i += 3) {
  const p = samples[i],
    t = tangents[i];
  for (const s of [-1, 1]) {
    const m = box(
      0.65,
      0.08,
      0.92,
      (i / 3) % 2 ? curbA : curbB,
      p.x + t.z * s * 10.2,
      0.05,
      p.z - t.x * s * 10.2,
    );
    m.rotation.y = Math.atan2(t.x, t.z);
  }
}
// Start gate, trackside lamps and illuminated corner markers.
const start = samples[0],
  startYaw = Math.atan2(tangents[0].x, tangents[0].z);
const gate = new T.Group();
gate.position.copy(start);
gate.rotation.y = startYaw;
scene.add(gate);
for (const x of [-12, 12]) box(0.45, 7, 0.45, rail, x, 3.5, 0, gate);
box(24.5, 0.65, 0.5, dark, 0, 7, 0, gate);
box(21, 0.07, 0.6, lime, 0, 6.6, 0, gate);
function label(text, color = "#b8ed50", width = 512) {
  const c = document.createElement("canvas");
  c.width = width;
  c.height = 128;
  const ctx = c.getContext("2d");
  ctx.fillStyle = "#111c24";
  ctx.fillRect(0, 0, width, 128);
  ctx.fillStyle = color;
  ctx.font = "bold 55px sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text, width / 2, 66);
  const tx = new T.CanvasTexture(c);
  tx.colorSpace = T.SRGBColorSpace;
  return new T.MeshBasicMaterial({ map: tx, side: T.DoubleSide });
}
const sign = new T.Mesh(new T.PlaneGeometry(13, 2), label("MIDNIGHT / 峠"));
sign.position.set(0, 7, 0.28);
gate.add(sign);
for (let x = -10; x < 10; x += 1)
  for (let z = -0.9; z < 0.9; z += 0.6)
    box(
      1,
      0.025,
      0.6,
      (Math.round(x) + Math.round(z / 0.6)) % 2 ? white : dark,
      x,
      0.07,
      z,
      gate,
    );
const lampMat = new T.MeshBasicMaterial({ color: "#cee9e0" });
for (let i = 10; i < samples.length; i += 60) {
  const p = samples[i],
    t = tangents[i];
  const s = i % 120 === 10 ? 1 : -1;
  const g = new T.Group();
  g.position.set(p.x + t.z * s * 15, 0, p.z - t.x * s * 15);
  g.rotation.y = Math.atan2(t.x, t.z);
  scene.add(g);
  box(0.2, 8, 0.2, rail, 0, 4, 0, g);
  box(3, 0.12, 0.45, rail, -s * 1.4, 8, 0, g);
  box(2.3, 0.06, 0.35, lampMat, -s * 1.4, 7.9, 0, g);
  const light = new T.PointLight("#abcfd1", 25, 23, 1.5);
  light.position.set(-s * 2.4, 7, 0);
  g.add(light);
}
for (let i = 40; i < samples.length; i += 85) {
  const p = samples[i],
    t = tangents[i];
  const g = new T.Mesh(new T.PlaneGeometry(3.5, 1.5), label("❯ ❯ ❯"));
  g.position.set(p.x + t.z * 12.3, 1.7, p.z - t.x * 12.3);
  g.rotation.y = Math.atan2(-t.z, t.x);
  scene.add(g);
}
// Deterministic scenery: low-poly pine forest, layered mountains and distant city.
let seed = 86;
const rand = () => {
  seed = (seed * 1664525 + 1013904223) >>> 0;
  return seed / 4294967296;
};
const ground = box(2400, 1, 2400, material("#172b2c"), 0, -0.6, 0);
const trunkMat = material("#222d2c"),
  leafMats = [material("#1d3e3d"), material("#234744"), material("#294a44")];
const treeTrunkGeo = new T.CylinderGeometry(0.22, 0.35, 3, 5),
  treeTopGeo = new T.ConeGeometry(2.6, 8, 6);
const trees = [];
for (let i = 0; i < 700; i++) {
  const x = (rand() - 0.5) * 850,
    z = (rand() - 0.5) * 850;
  if (nearestRoad(x, z).distance < 20) continue;
  trees.push({ x, z, scale: 0.7 + rand() * 1.3 });
}
const trunks = new T.InstancedMesh(treeTrunkGeo, trunkMat, trees.length),
  leaves = new T.InstancedMesh(treeTopGeo, leafMats[0], trees.length),
  leaves2 = new T.InstancedMesh(treeTopGeo, leafMats[1], trees.length);
const dummy = new T.Object3D();
trees.forEach((p, i) => {
  dummy.position.set(p.x, 1.5 * p.scale, p.z);
  dummy.scale.setScalar(p.scale);
  dummy.updateMatrix();
  trunks.setMatrixAt(i, dummy.matrix);
  dummy.position.y = 5.2 * p.scale;
  dummy.updateMatrix();
  leaves.setMatrixAt(i, dummy.matrix);
  dummy.position.y = 8 * p.scale;
  dummy.scale.setScalar(p.scale * 0.72);
  dummy.updateMatrix();
  leaves2.setMatrixAt(i, dummy.matrix);
});
scene.add(trunks, leaves, leaves2);
for (let i = 0; i < 30; i++) {
  const a = (i / 30) * Math.PI * 2,
    r = 520 + rand() * 300,
    h = 100 + rand() * 230;
  const m = new T.Mesh(
    new T.ConeGeometry(120 + rand() * 180, h, 5),
    material(i % 2 ? "#263a49" : "#20313f"),
  );
  m.position.set(Math.sin(a) * r, h / 2 - 10, Math.cos(a) * r);
  m.rotation.y = rand() * 6;
  scene.add(m);
}
const moon = new T.Mesh(
  new T.SphereGeometry(14, 24, 16),
  new T.MeshBasicMaterial({ color: "#e0ebd9" }),
);
moon.position.set(230, 190, -420);
scene.add(moon);
const starPositions = [];
for (let i = 0; i < 600; i++) {
  const a = rand() * Math.PI * 2,
    y = rand() * 0.8 + 0.15,
    r = 950;
  starPositions.push(Math.cos(a) * r, 150 + y * 650, Math.sin(a) * r);
}
const stars = new T.BufferGeometry();
stars.setAttribute("position", new T.Float32BufferAttribute(starPositions, 3));
scene.add(
  new T.Points(
    stars,
    new T.PointsMaterial({
      color: "#b7cfd5",
      size: 1.2,
      sizeAttenuation: true,
    }),
  ),
);
// Batch static scenery by material to keep forest and track affordable on mobile GPUs.
scene.updateMatrixWorld(true);
const batches = new Map();
scene.traverse((object) => {
  if (
    !object.isMesh ||
    object.isInstancedMesh ||
    Array.isArray(object.material) ||
    object.material.transparent
  )
    return;
  const list = batches.get(object.material) || [];
  list.push(object);
  batches.set(object.material, list);
});
for (const [mat, objects] of batches) {
  if (objects.length < 2) continue;
  const geometries = objects.map((m) => {
    const g = m.geometry.clone().applyMatrix4(m.matrixWorld);
    if (!mat.map) g.deleteAttribute("uv");
    return g;
  });
  const merged = mergeGeometries(geometries);
  geometries.forEach((g) => g.dispose());
  if (merged) {
    objects.forEach((m) => m.removeFromParent());
    scene.add(new T.Mesh(merged, mat));
  }
}
// Original procedural sports coupe, nose facing +Z.
export const car = new T.Group();
scene.add(car);
box(1.86, 0.42, 4.15, paint, 0, 0.66, 0, car);
box(1.97, 0.17, 4.05, paint, 0, 0.43, 0, car);
box(1.76, 0.18, 1.25, paint, 0, 0.94, 1.27, car);
box(1.74, 0.13, 0.7, paint, 0, 0.94, -1.55, car);
const cabin = new T.Mesh(
  new T.CylinderGeometry(1, 1, 1, 4, 1, false, Math.PI / 4),
  glass,
);
cabin.scale.set(1.08, 0.6, 1.42);
cabin.position.set(0, 1.15, -0.22);
car.add(cabin);
box(1.42, 0.1, 1.4, paint, 0, 1.48, -0.3, car);
for (const s of [-1, 1]) {
  const pillar = box(0.09, 0.6, 0.12, paint, s * 0.75, 1.2, 0.53, car);
  pillar.rotation.x = -0.5;
  box(0.2, 0.14, 0.32, dark, s * 1.02, 1.02, 0.5, car);
  box(0.08, 0.1, 2.8, dark, s * 0.96, 0.37, 0, car);
  box(0.08, 0.35, 0.12, dark, s * 0.65, 1.13, -1.75, car);
}
box(2.06, 0.12, 0.5, dark, 0, 1.32, -1.8, car);
box(1.9, 0.12, 0.13, paint, 0, 1.4, -2, car);
box(1.5, 0.16, 0.08, dark, 0, 0.48, 2.1, car);
box(1.8, 0.16, 0.09, dark, 0, 0.45, -2.1, car);
const headMat = new T.MeshBasicMaterial({ color: "#effff1" }),
  tailMat = new T.MeshBasicMaterial({ color: "#ff3c42" });
for (const s of [-1, 1]) {
  box(0.61, 0.17, 0.08, headMat, s * 0.56, 0.78, 2.1, car);
  box(0.7, 0.13, 0.08, tailMat, s * 0.54, 0.77, -2.1, car);
  box(0.35, 0.08, 0.08, lime, s * 0.7, 0.4, 2.1, car);
}
const plate = new T.Mesh(
  new T.PlaneGeometry(0.55, 0.18),
  label("KAGE 86", "#cbd4cc"),
);
plate.position.set(0, 0.62, -2.115);
plate.rotation.y = Math.PI;
car.add(plate);
export const wheels = [];
const tireGeo = new T.CylinderGeometry(0.37, 0.37, 0.28, 16),
  rimGeo = new T.CylinderGeometry(0.25, 0.25, 0.285, 12);
const rubber = material("#0a1017"),
  rim = material("#7f949d", 0.3, 0.8);
for (const x of [-0.96, 0.96])
  for (const z of [-1.3, 1.3]) {
    const wheel = new T.Group();
    wheel.position.set(x, 0.39, z);
    wheel.rotation.order = "YXZ";
    const tire = new T.Mesh(tireGeo, rubber);
    tire.rotation.z = Math.PI / 2;
    wheel.add(tire);
    const hub = new T.Mesh(rimGeo, rim);
    hub.rotation.z = Math.PI / 2;
    wheel.add(hub);
    car.add(wheel);
    wheels.push(wheel);
  }
const underglow = new T.PointLight("#b8ed50", 3, 5, 1.5);
underglow.position.set(0, 0.24, 0);
car.add(underglow);
// Transparent ground decal anchors the car without expensive dynamic shadows.
const shadowCanvas = document.createElement("canvas");
shadowCanvas.width = 64;
shadowCanvas.height = 64;
const sc = shadowCanvas.getContext("2d"),
  gradient = sc.createRadialGradient(32, 32, 3, 32, 32, 32);
gradient.addColorStop(0, "rgba(0,0,0,.65)");
gradient.addColorStop(1, "rgba(0,0,0,0)");
sc.fillStyle = gradient;
sc.fillRect(0, 0, 64, 64);
const shadow = new T.Mesh(
  new T.PlaneGeometry(3.7, 6),
  new T.MeshBasicMaterial({
    map: new T.CanvasTexture(shadowCanvas),
    transparent: true,
    depthWrite: false,
  }),
);
shadow.rotation.x = -Math.PI / 2;
shadow.position.y = 0.085;
export const groundEffects = new T.Group();
scene.add(groundEffects);
groundEffects.add(shadow);
const beamGeo = new T.PlaneGeometry(5, 28);
const beamMat = new T.MeshBasicMaterial({
  color: "#c3d8bb",
  transparent: true,
  opacity: 0.055,
  depthWrite: false,
  side: T.DoubleSide,
});
for (const s of [-1, 1]) {
  const beam = new T.Mesh(beamGeo, beamMat);
  beam.rotation.x = -Math.PI / 2;
  beam.position.set(s * 0.6, 0.09, 15);
  groundEffects.add(beam);
}
export function setBrake(on) {
  tailMat.color.set(on ? "#ff8d78" : "#ff3c42");
}
export function spawn() {
  const p = samples[8],
    t = tangents[8];
  return { x: p.x, z: p.z, yaw: Math.atan2(t.x, t.z) };
}
// Pool all smoke sprites and skid segments: long sessions never grow GPU resources.
const smokeCanvas = document.createElement("canvas");
smokeCanvas.width = 64;
smokeCanvas.height = 64;
const sx = smokeCanvas.getContext("2d"),
  sg = sx.createRadialGradient(32, 32, 0, 32, 32, 32);
sg.addColorStop(0, "rgba(200,215,213,.6)");
sg.addColorStop(1, "rgba(200,215,213,0)");
sx.fillStyle = sg;
sx.fillRect(0, 0, 64, 64);
const smokeTex = new T.CanvasTexture(smokeCanvas);
const smoke = Array.from({ length: 100 }, () => {
  const m = new T.Sprite(
    new T.SpriteMaterial({
      map: smokeTex,
      transparent: true,
      opacity: 0,
      depthWrite: false,
    }),
  );
  m.name = "tire-smoke";
  m.visible = false;
  scene.add(m);
  return { m, life: 0, vx: 0, vz: 0, ttl: 1.6, size: 1, opacity: 0.23 };
});
let smokeIndex = 0;
const skids = new T.InstancedMesh(
  new T.PlaneGeometry(0.23, 0.8),
  new T.MeshBasicMaterial({
    color: "#0b121a",
    transparent: true,
    opacity: 0.6,
    depthWrite: false,
  }),
  1800,
);
skids.count = 0;
// Instance positions move around the whole circuit; a cached early bound clips later marks.
skids.frustumCulled = false;
skids.name = "skid-marks";
scene.add(skids);
let skidIndex = 0,
  emitTime = 0;
export function resetEffects() {
  skidIndex = 0;
  smokeIndex = 0;
  emitTime = 0;
  skids.count = 0;
  for (const p of smoke) {
    p.life = 0;
    p.m.visible = false;
    p.m.material.opacity = 0;
  }
}
export function updateEffects(s, dt, active) {
  for (const p of smoke) {
    if (p.life <= 0) continue;
    p.life = Math.max(0, p.life - dt);
    p.m.visible = p.life > 0;
    p.m.position.x += p.vx * dt;
    p.m.position.z += p.vz * dt;
    p.m.position.y += dt * 0.8;
    p.m.scale.setScalar(p.size * (1 + (p.ttl - p.life) * 2.8));
    p.m.material.opacity = Math.max(0, p.life / p.ttl) * p.opacity;
  }
  if (!active) {
    emitTime = 0;
    return;
  }
  const intensity = Math.max(0, Math.min(1, s.tireSmoke ?? 1));
  emitTime += dt;
  if (emitTime < 0.06 - intensity * 0.035) return;
  const interval = emitTime;
  emitTime = 0;
  const markYaw = Math.hypot(s.vx, s.vz) > 0.1 ? Math.atan2(s.vx, s.vz) : s.yaw;
  for (const side of [-1, 1]) {
    const x = s.x + Math.sin(s.yaw) * -1.3 + Math.cos(s.yaw) * side * 0.85,
      z = s.z + Math.cos(s.yaw) * -1.3 - Math.sin(s.yaw) * side * 0.85;
    const p = smoke[smokeIndex++ % smoke.length];
    p.ttl = 1.2 + intensity * 0.6;
    p.life = p.ttl;
    p.size = 0.65 + intensity * 0.5;
    p.opacity = 0.1 + intensity * 0.23;
    p.m.visible = true;
    p.m.material.opacity = p.opacity;
    p.vx = s.vx * 0.08 + Math.cos(s.yaw) * side * 0.25;
    p.vz = s.vz * 0.08 - Math.sin(s.yaw) * side * 0.25;
    p.m.position.set(x, 0.35, z);
    p.m.scale.setScalar(p.size);
    dummy.position.set(x, 0.09, z);
    dummy.rotation.set(-Math.PI / 2, 0, markYaw);
    dummy.scale.set(1, Math.max(0.18, s.speed * interval) / 0.8, 1);
    dummy.updateMatrix();
    skids.setMatrixAt(skidIndex++ % 1800, dummy.matrix);
    skids.count = Math.min(skidIndex, 1800);
  }
  skids.instanceMatrix.needsUpdate = true;
}
