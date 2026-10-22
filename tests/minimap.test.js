import test from "node:test";
import assert from "node:assert/strict";
import { createMinimap } from "../src/minimap.js";
function canvas() {
  const calls = { lines: 0, strokes: 0, images: [], positions: [] };
  const context = {
    beginPath() {},
    closePath() {},
    lineTo() {
      calls.lines++;
    },
    moveTo() {},
    stroke() {
      calls.strokes++;
    },
    fillRect() {},
    clearRect() {},
    save() {},
    restore() {},
    rotate() {},
    fill() {},
    translate(x, z) {
      calls.positions.push([x, z]);
    },
    drawImage(image) {
      calls.images.push(image);
    },
  };
  return { width: 240, height: 200, getContext: () => context, calls };
}
test("minimap caches its circuit and only draws the moving marker on HUD updates", () => {
  let cached;
  globalThis.document = { createElement: () => (cached = canvas()) };
  const target = canvas();
  const points = Array.from({ length: 900 }, (_, i) => ({
    x: Math.sin((i / 900) * Math.PI * 2) * 100,
    z: Math.cos((i / 900) * Math.PI * 2) * 80,
  }));
  const draw = createMinimap(target, points);
  assert.equal(cached.calls.strokes, 3);
  assert.equal(cached.calls.lines, 899);
  for (let i = 0; i < 100; i++) draw({ x: i / 2, z: 0, yaw: 0.5 });
  assert.equal(cached.calls.strokes, 3);
  assert.equal(target.calls.images.length, 100);
  assert(target.calls.images.every((image) => image === cached));
  assert.equal(
    target.calls.lines,
    200,
    "HUD should draw only two marker edges per update",
  );
  assert(
    target.calls.positions.every(
      ([x, z]) =>
        Number.isFinite(x) &&
        Number.isFinite(z) &&
        x > 0 &&
        x < 240 &&
        z > 0 &&
        z < 200,
    ),
  );
});
