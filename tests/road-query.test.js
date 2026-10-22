import test from "node:test";
import assert from "node:assert/strict";
import { createRoadQuery } from "../src/road-query.js";
import { createEnvironment } from "./support/environment.js";
createEnvironment();
const { samples, nearestRoad, HALF_WIDTH } = await import("../src/world.js");
function reference(points, x, z) {
  let best = Infinity,
    result;
  points.forEach((a, index) => {
    const b = points[(index + 1) % points.length],
      dx = b.x - a.x,
      dz = b.z - a.z,
      lengthSquared = dx * dx + dz * dz,
      t =
        lengthSquared === 0
          ? 0
          : Math.max(
              0,
              Math.min(1, ((x - a.x) * dx + (z - a.z) * dz) / lengthSquared),
            ),
      px = a.x + dx * t,
      pz = a.z + dz * t,
      squared = (x - px) ** 2 + (z - pz) ** 2;
    if (squared < best) {
      best = squared;
      result = {
        x: px,
        z: pz,
        index,
        progress: (index + t) / points.length,
        distance: Math.sqrt(squared),
        halfWidth: HALF_WIDTH,
      };
    }
  });
  return result;
}
test("indexed road projections match exhaustive search on and far outside the real circuit", () => {
  let seed = 12648430;
  const random = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 2 ** 32;
  };
  for (let i = 0; i < 2000; i++) {
    const x = (random() - 0.5) * (i % 2 ? 360 : 10000),
      z = (random() - 0.5) * (i % 2 ? 360 : 10000);
    assert.deepEqual(nearestRoad(x, z), reference(samples, x, z));
  }
  for (const p of samples)
    assert.deepEqual(nearestRoad(p.x, p.z), reference(samples, p.x, p.z));
});
test("intersection and zero-length segments retain deterministic progress", () => {
  const points = [
      { x: -10, z: -10 },
      { x: 10, z: 10 },
      { x: 10, z: 10 },
      { x: -10, z: 10 },
      { x: 10, z: -10 },
    ],
    query = createRoadQuery(points, HALF_WIDTH);
  for (const point of [...points, { x: 0, z: 0 }, { x: 50, z: 50 }])
    assert.deepEqual(
      query(point.x, point.z),
      reference(points, point.x, point.z),
    );
  assert.equal(query(0, 0).index, 0);
  assert.throws(() => createRoadQuery([], 10), TypeError);
});
test("driving corridor queries prune at least 90 percent of segment tests on average", () => {
  let tested = 0;
  const diagnostics = {};
  for (let i = 0; i < samples.length; i += 3) {
    nearestRoad(samples[i].x + 4, samples[i].z - 4, diagnostics);
    tested += diagnostics.testedSegments;
  }
  assert(tested / (samples.length / 3) < samples.length * 0.1);
});
