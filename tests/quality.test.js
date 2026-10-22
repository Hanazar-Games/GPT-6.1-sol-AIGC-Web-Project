import test from "node:test";
import assert from "node:assert/strict";
import { RenderQuality, RenderSchedule } from "../src/quality.js";
test("quality modes limit pixel load on large high-density displays", () => {
  const viewport = { width: 3840, height: 2160, dpr: 3 };
  const smooth = new RenderQuality("performance", viewport),
    high = new RenderQuality("high", viewport);
  assert(smooth.ratio < high.ratio);
  assert(smooth.ratio <= 1);
  assert(high.ratio <= 2);
  assert(smooth.ratio ** 2 * viewport.width * viewport.height <= 1_000_001);
  assert(high.ratio ** 2 * viewport.width * viewport.height <= 3_500_001);
});
test("automatic quality reacts to sustained slow frames, recovers gradually and ignores tab suspension", () => {
  const quality = new RenderQuality("auto", {
    width: 1000,
    height: 700,
    dpr: 2,
  });
  const before = quality.ratio;
  for (let i = 0; i < 70; i++) quality.sample(1 / 20);
  assert(quality.ratio < before);
  const lowered = quality.ratio;
  assert.equal(quality.sample(30), false);
  assert.equal(quality.ratio, lowered);
  for (let i = 0; i < 2000; i++) quality.sample(1 / 60);
  assert(quality.ratio > lowered && quality.ratio <= quality.maximum);
  quality.setMode("high");
  const fixed = quality.ratio;
  for (let i = 0; i < 200; i++) quality.sample(1 / 15);
  assert.equal(quality.ratio, fixed);
});
test("resize updates density caps without producing invalid render dimensions", () => {
  const quality = new RenderQuality("high", {
    width: 800,
    height: 600,
    dpr: 1,
  });
  assert.equal(quality.ratio, 1);
  assert.equal(quality.resize({ width: 800, height: 600, dpr: 2 }), 2);
  quality.resize({ width: 0, height: 0, dpr: 0 });
  assert(Number.isFinite(quality.ratio) && quality.ratio > 0);
});
test("garage redraws are capped while active driving keeps each animation frame", () => {
  const idle = new RenderSchedule(),
    active = new RenderSchedule();
  let idleDraws = 0,
    activeDraws = 0;
  for (let i = 0; i < 120; i++) {
    if (idle.shouldRender((i * 1000) / 60)) idleDraws++;
    if (active.shouldRender((i * 1000) / 60, { active: true })) activeDraws++;
  }
  assert(idleDraws <= 61 && idleDraws >= 58);
  assert.equal(activeDraws, 120);
  idle.invalidate();
  assert(idle.shouldRender(2000));
});
test("hidden tabs skip drawing and reduced-motion garages redraw only on changes", () => {
  const schedule = new RenderSchedule();
  assert(!schedule.shouldRender(0, { hidden: true }));
  assert(schedule.shouldRender(1, { reducedMotion: true }));
  assert(!schedule.shouldRender(1000, { reducedMotion: true }));
  schedule.invalidate();
  assert(schedule.shouldRender(1001, { reducedMotion: true }));
});
