import test from "node:test";
import assert from "node:assert/strict";
import { InputState } from "../src/input.js";
test("keyboard and multitouch releases are independent", () => {
  const input = new InputState();
  input.press("key:KeyW", "KeyW");
  input.press("pointer:1", "KeyW");
  input.press("pointer:2", "KeyA");
  input.release("pointer:1");
  assert(input.has("KeyW"));
  assert(input.has("KeyA"));
  input.release("key:KeyW");
  assert(!input.has("KeyW"));
  assert(input.has("KeyA"));
  input.clear();
  assert(!input.has("KeyA"));
  input.release("pointer:2");
  assert(!input.has("KeyA"));
});
test("removing pointer sources preserves held keyboard controls", () => {
  const input = new InputState();
  input.press("key:KeyW", "KeyW");
  input.press("pointer:1", "KeyW");
  input.press("pointer:2", "KeyA");
  input.releasePointers();
  assert(input.has("KeyW"));
  assert(!input.has("KeyA"));
  input.release("key:KeyW");
  assert(!input.has("KeyW"));
});
test("brief handbrake taps survive a frame boundary and expire in simulation time", () => {
  const input = new InputState();
  input.press("key:Space", "Space");
  input.release("key:Space");
  assert(input.has("Space"));
  for (let i = 0; i < 14; i++) input.advance(1 / 120);
  assert(input.has("Space"));
  input.advance(1 / 120);
  assert(!input.has("Space"));
});
test("device removal and pause clear their pending taps without releasing another input source", () => {
  const input = new InputState();
  input.press("pointer:1", "Space");
  input.release("pointer:1");
  input.releasePointers();
  assert(!input.has("Space"));
  input.press("key:Space", "Space");
  input.release("key:Space");
  input.press("pointer:2", "Space");
  input.releasePointers();
  assert(input.has("Space"));
  input.clear();
  assert(!input.has("Space"));
  input.press("pointer:3", "Space");
  input.release("pointer:3", true);
  assert(
    !input.has("Space"),
    "cancelled gestures must not queue handbrake taps",
  );
});
