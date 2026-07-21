const assert = require("node:assert/strict");
const test = require("node:test");
const { TaskScheduler } = require("../dist/src/scheduler.js");

const deferred = () => { let resolve, reject; const promise = new Promise((ok, fail) => { resolve = ok; reject = fail; }); return { promise, resolve, reject }; };

test("canonical scheduler acceptance: FIFO and concurrency never exceed the limit", async () => {
  const scheduler = new TaskScheduler({ concurrency: 2, maxAttempts: 1 });
  const first = deferred(), second = deferred(), third = deferred(), started = [], active = { value: 0, maximum: 0 };
  const task = (id, hold) => scheduler.schedule(id, async () => { started.push(id); active.maximum = Math.max(active.maximum, ++active.value); await hold.promise; active.value--; return id; });
  const a = task("a", first), b = task("b", second), c = task("c", third);
  assert.deepEqual(started, ["a", "b"]);
  assert.equal(active.maximum, 2);
  first.resolve(); second.resolve();
  await Promise.all([a, b]); third.resolve();
  await c;
  assert.deepEqual(started, ["a", "b", "c"]);
});

test("canonical scheduler acceptance: duplicate IDs and queued/running cancellation", async () => {
  const scheduler = new TaskScheduler({ concurrency: 1, maxAttempts: 2 });
  const running = deferred(), calls = [];
  const first = scheduler.schedule("same", async ({ signal, attempt }) => { calls.push([attempt, signal.aborted]); return running.promise; });
  await assert.rejects(scheduler.schedule("same", async () => 2), /duplicate/i);
  assert.equal(scheduler.cancel("same"), true);
  assert.equal(calls[0][1], true);
  running.reject(new Error("aborted"));
  await assert.rejects(first, /aborted/);
  let queuedRan = false;
  const blocker = deferred(), queued = scheduler.schedule("blocker", async () => blocker.promise), cancelled = scheduler.schedule("queued", async () => { queuedRan = true; return 1; });
  assert.equal(scheduler.cancel("queued"), true); blocker.resolve(); await queued; await assert.rejects(cancelled, /cancel/i); assert.equal(queuedRan, false);
});

test("canonical scheduler acceptance: retries, drain, and final errors are deterministic", async () => {
  const scheduler = new TaskScheduler({ concurrency: 1, maxAttempts: 2 });
  let attempts = 0;
  await assert.rejects(scheduler.schedule("retry", async ({ attempt }) => { attempts = attempt; throw new Error("final"); }), /final/);
  assert.equal(attempts, 2);
  await scheduler.drain();
});
