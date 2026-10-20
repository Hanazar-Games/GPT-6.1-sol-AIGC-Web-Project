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
