import test from "node:test";
import assert from "node:assert/strict";
// Geometry QA without a browser/GPU. Textures use a minimal canvas stand-in.
globalThis.document = {
  createElement() {
    return {
      width: 0,
      height: 0,
      getContext() {
        return {
          fillRect() {},
          fillText() {},
          createRadialGradient() {
            return { addColorStop() {} };
          },
        };
      },
    };
  },
};
const world = await import("../src/world.js");
test("procedural track is closed, finite and has a valid spawn", () => {
  assert.equal(world.samples.length, 900);
  const p = world.spawn();
  assert(Number.isFinite(p.yaw));
  assert(world.nearestRoad(p.x, p.z).distance < 0.001);
  assert(world.samples[0].distanceTo(world.samples.at(-1)) < 2);
});
test("static scenery batches successfully and all vertices are finite", () => {
  let meshes = 0;
  world.scene.traverse((o) => {
    if (!o.isMesh) return;
    meshes++;
    const position = o.geometry.attributes.position;
    for (const v of position.array) assert(Number.isFinite(v));
  });
  assert(meshes < 110, `Expected batched scene, got ${meshes} mesh draws`);
});
test("smoke and skid resource pools stay bounded", () => {
  const before = world.scene.children.length;
  const s = { ...world.spawn(), vx: 15, vz: 20, speed: 25 };
  for (let i = 0; i < 2200; i++) world.updateEffects(s, 0.04, true);
  assert.equal(world.scene.children.length, before);
});
test("new session clears pooled smoke and skid marks without losing resources", () => {
  const s = { ...world.spawn(), vx: 10, vz: 10, speed: 15 };
  world.updateEffects(s, 0.04, true);
  const skids = world.scene.getObjectByName("skid-marks");
  assert(skids.count > 0);
  assert.equal(skids.frustumCulled, false);
  world.resetEffects();
  assert.equal(skids.count, 0);
  const smoke = [];
  world.scene.traverse((o) => {
    if (o.name === "tire-smoke") smoke.push(o);
  });
  assert.equal(smoke.length, 100);
  assert(smoke.every((o) => o.material.opacity === 0));
  world.updateEffects(s, 0.04, true);
  assert.equal(skids.count, 2);
});
test("expired and reset smoke is hidden rather than submitted as transparent draws", () => {
  world.resetEffects();
  const smoke = [];
  world.scene.traverse((o) => {
    if (o.name === "tire-smoke") smoke.push(o);
  });
  assert(smoke.every((o) => !o.visible));
  const s = { ...world.spawn(), vx: 10, vz: 10, speed: 15 };
  world.updateEffects(s, 0.04, true);
  assert.equal(smoke.filter((o) => o.visible).length, 2);
  world.updateEffects(s, 2, false);
  assert(smoke.every((o) => !o.visible));
});
test("skid marks follow actual travel even when the car is sideways", async () => {
  const { Matrix4, Vector3 } = await import("three");
  const matrix = new Matrix4();
  for (const [yaw, direction] of [
    [0.3, 0.3],
    [Math.PI / 4, Math.PI / 4],
    [-Math.PI / 3, -Math.PI / 3],
    [1.2, 0],
  ]) {
    const vx = 25 * Math.sin(direction),
      vz = 25 * Math.cos(direction);
    world.resetEffects();
    world.updateEffects({ x: 0, z: 0, yaw, vx, vz, speed: 25 }, 0.04, true);
    world.scene.getObjectByName("skid-marks").getMatrixAt(0, matrix);
    const alongMark = new Vector3(0, 1, 0).transformDirection(matrix);
    const travel = new Vector3(vx, 0, vz).normalize();
    assert(Math.abs(alongMark.dot(travel)) > 0.999);
  }
});
test("skid lengths cover distance between emissions without including idle time", async () => {
  const { Matrix4, Vector3 } = await import("three");
  const matrix = new Matrix4(),
    s = { x: 0, z: 0, yaw: 0, vx: 0, vz: 25, speed: 25 };
  for (const interval of [0.04, 0.08]) {
    world.resetEffects();
    world.updateEffects(s, 100, false);
    world.updateEffects(s, interval, true);
    world.scene.getObjectByName("skid-marks").getMatrixAt(0, matrix);
    const length = new Vector3().setFromMatrixColumn(matrix, 1).length() * 0.8;
    assert(Math.abs(length - 25 * interval) < 1e-5);
  }
});
test("steered wheel axle stays horizontal while the wheel spins", async () => {
  const { Vector3 } = await import("three");
  const wheel = world.wheels.find((w) => w.position.z > 0),
    saved = wheel.rotation.clone();
  try {
    for (const spin of [0.5, 1.2, 2.5]) {
      wheel.rotation.set(spin, 0.4, 0);
      wheel.updateMatrix();
      const axle = new Vector3(1, 0, 0).transformDirection(wheel.matrix);
      assert(
        Math.abs(axle.y) < 1e-8,
        "steering must happen outside the rolling rotation",
      );
    }
  } finally {
    wheel.rotation.copy(saved);
    wheel.updateMatrix();
  }
});
test("stationary wheelspin emits smoke and short rear tire patches, then the smoke expires", async () => {
  const { Matrix4, Vector3 } = await import("three");
  world.resetEffects();
  const s = { ...world.spawn(), vx: 0, vz: 0, speed: 0, tireSmoke: 1 };
  for (let i = 0; i < 25; i++) world.updateEffects(s, 0.04, true);
  const smoke = [];
  world.scene.traverse((o) => {
    if (o.name === "tire-smoke") smoke.push(o);
  });
  assert(smoke.filter((o) => o.visible && o.material.opacity > 0).length > 10);
  const skids = world.scene.getObjectByName("skid-marks"),
    matrix = new Matrix4();
  skids.getMatrixAt(0, matrix);
  assert(skids.count > 0);
  assert(new Vector3().setFromMatrixColumn(matrix, 1).length() * 0.8 < 0.3);
  world.updateEffects(s, 2, false);
  assert(smoke.every((o) => !o.visible));
});
test("curved skid segments connect each rear tire's successive contact positions", async () => {
  const { Matrix4, Vector3 } = await import("three");
  const contacts = (s) => {
    const transform = new Matrix4()
      .makeRotationY(s.yaw)
      .setPosition(s.x, 0, s.z);
    return world.wheels
      .filter((w) => w.position.z < 0)
      .map((w) => w.position.clone().applyMatrix4(transform).setY(0.09));
  };
  const first = {
    x: 0,
    z: 0,
    yaw: 0,
    vx: 3,
    vz: 12,
    speed: Math.hypot(3, 12),
    tireSmoke: 1,
  };
  const second = {
    x: 0.2,
    z: 0.7,
    yaw: 0.55,
    vx: 10,
    vz: 2,
    speed: Math.hypot(10, 2),
    tireSmoke: 1,
  };
  world.resetEffects();
  world.updateEffects(first, 0.04, true);
  world.updateEffects(second, 0.04, true);
  const before = contacts(first),
    after = contacts(second),
    skids = world.scene.getObjectByName("skid-marks"),
    matrix = new Matrix4();
  for (let i = 0; i < 2; i++) {
    skids.getMatrixAt(i + 2, matrix);
    const ends = [
      new Vector3(0, -0.4, 0).applyMatrix4(matrix),
      new Vector3(0, 0.4, 0).applyMatrix4(matrix),
    ];
    assert(Math.min(...ends.map((p) => p.distanceTo(before[i]))) < 1e-5);
    assert(
      Math.min(...ends.map((p) => p.distanceTo(after[i]))) < 1e-5,
      "the new segment must end at its own tire, even during yaw change",
    );
  }
});
test("first skid segments trail the rear tires and smoke uses the wheel geometry", async () => {
  const { Matrix4, Vector3 } = await import("three");
  const car = { x: 0, z: 0, yaw: 0, vx: 0, vz: 25, speed: 25, tireSmoke: 1 };
  world.resetEffects();
  world.updateEffects(car, 0.04, true);
  const matrix = new Matrix4();
  world.scene.getObjectByName("skid-marks").getMatrixAt(0, matrix);
  const ends = [
    new Vector3(0, -0.4, 0).applyMatrix4(matrix),
    new Vector3(0, 0.4, 0).applyMatrix4(matrix),
  ];
  assert(
    Math.max(...ends.map((p) => p.z)) <= -1.3 + 1e-6,
    "moving tire marks must not be painted ahead of the contact patch",
  );
  const smoke = [];
  world.scene.traverse((o) => {
    if (o.name === "tire-smoke" && o.visible) smoke.push(o);
  });
  const rear = world.wheels.filter((w) => w.position.z < 0);
  for (let i = 0; i < 2; i++) {
    assert(Math.abs(smoke[i].position.x - rear[i].position.x) < 1e-8);
    assert(Math.abs(smoke[i].position.z - rear[i].position.z) < 1e-8);
  }
});
test("trail breaks and inactive gaps never connect tire marks across a teleport", async () => {
  const { Matrix4, Vector3 } = await import("three");
  for (const interrupt of [
    () => world.breakEffectsTrail(),
    (s) => world.updateEffects(s, 0.1, false),
  ]) {
    world.resetEffects();
    const s = { x: 0, z: 0, yaw: 0, vx: 0, vz: 10, speed: 10, tireSmoke: 1 };
    world.updateEffects(s, 0.04, true);
    interrupt(s);
    world.updateEffects({ ...s, x: 500, z: 500 }, 0.04, true);
    const matrix = new Matrix4();
    world.scene.getObjectByName("skid-marks").getMatrixAt(2, matrix);
    assert(
      new Vector3().setFromMatrixColumn(matrix, 1).length() * 0.8 < 0.5,
      "resuming emission must start a fresh short segment",
    );
    assert.equal(
      world.scene.getObjectByName("skid-marks").count,
      4,
      "breaking a trail must preserve existing skid marks",
    );
  }
});
