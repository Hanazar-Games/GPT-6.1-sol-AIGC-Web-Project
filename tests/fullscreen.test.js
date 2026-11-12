import test from "node:test";
import assert from "node:assert/strict";
import { FullscreenControl } from "../src/fullscreen.js";
test("unsupported environments never attempt to enter fullscreen", async () => {
  let calls = 0;
  const control = new FullscreenControl({
    fullscreenEnabled: false,
    documentElement: {
      requestFullscreen() {
        calls++;
      },
    },
  });
  assert(!control.supported);
  assert.equal(await control.toggle(), false);
  assert.equal(calls, 0);
});
test("fullscreen requests target the document root, serialize transitions and recover after rejection", async () => {
  let resolve,
    entered = 0,
    exited = 0;
  const doc = {
    fullscreenEnabled: true,
    fullscreenElement: null,
    documentElement: {
      requestFullscreen() {
        entered++;
        return new Promise((r) => {
          resolve = () => {
            doc.fullscreenElement = doc.documentElement;
            r();
          };
        });
      },
    },
    async exitFullscreen() {
      exited++;
      doc.fullscreenElement = null;
    },
  };
  const control = new FullscreenControl(doc);
  const entering = control.toggle();
  assert(control.pending);
  assert.equal(await control.toggle(), false);
  assert.equal(entered, 1);
  resolve();
  assert.equal(await entering, true);
  assert(control.active && !control.pending);
  await control.toggle();
  assert(!control.active && exited === 1);
  doc.documentElement.requestFullscreen = async () => {
    throw new Error("denied");
  };
  await assert.rejects(control.toggle(), /denied/);
  assert(!control.pending && !control.active);
});
