import assert from "node:assert/strict";
import test from "node:test";
import { TaskScheduler } from "../src/scheduler";

test("starts ready tasks FIFO within the configured concurrency", async () => {
  const scheduler = new TaskScheduler({ concurrency: 1, maxAttempts: 2 }), order: string[] = [];
  await Promise.all([scheduler.schedule("a", async () => { order.push("a"); return 1; }), scheduler.schedule("b", async () => { order.push("b"); return 2; })]);
  await scheduler.drain();
  assert.deepEqual(order, ["a", "b"]);
});
