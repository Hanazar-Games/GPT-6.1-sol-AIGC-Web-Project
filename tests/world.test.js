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
