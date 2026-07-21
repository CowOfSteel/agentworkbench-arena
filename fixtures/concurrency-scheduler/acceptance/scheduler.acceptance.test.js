const assert = require("node:assert/strict");
const test = require("node:test");
const { TaskScheduler } = require("../dist/src/scheduler.js");

const deferred = () => { let resolve, reject; const promise = new Promise((ok, fail) => { resolve = ok; reject = fail; }); return { promise, resolve, reject }; };
const settled = async (promise) => promise.then((value) => ({ status: "fulfilled", value }), (reason) => ({ status: "rejected", reason }));

test("canonical scheduler acceptance: FIFO and concurrency never exceed the limit", async () => {
  const scheduler = new TaskScheduler({ concurrency: 2, maxAttempts: 1 });
  const first = deferred(), second = deferred(), third = deferred(), started = [], active = { value: 0, maximum: 0 };
  const task = (id, hold) => scheduler.schedule(id, async () => { started.push(id); active.maximum = Math.max(active.maximum, ++active.value); try { await hold.promise; return id; } finally { active.value--; } });
  const a = task("a", first), b = task("b", second), c = task("c", third);
  assert.deepEqual(started, ["a", "b"]);
  assert.equal(active.maximum, 2);
  first.resolve(); await a; await Promise.resolve();
  assert.deepEqual([...started], ["a", "b", "c"]);
  second.resolve(); third.resolve();
  await Promise.all([b, c]);
  assert.deepEqual([...started], ["a", "b", "c"]);
  assert.equal(active.maximum, 2);
});

test("canonical scheduler acceptance: duplicate IDs, cancellation, and terminal ID reuse", async () => {
  const scheduler = new TaskScheduler({ concurrency: 1, maxAttempts: 2 });
  const running = deferred(), signals = [], attempts = [];
  const first = scheduler.schedule("same", async ({ signal, attempt }) => { signals.push(signal); attempts.push(attempt); return running.promise; });
  const duplicate = scheduler.schedule("same", async () => 2);
  const cancelledRunning = scheduler.cancel("same");
  const aborted = signals[0]?.aborted;
  running.reject(new Error("aborted"));
  const [firstResult, duplicateResult] = await Promise.all([settled(first), settled(duplicate)]);
  const reused = await scheduler.schedule("same", async () => "reused");

  const blocker = deferred(); let queuedRan = false;
  const queuedBlocker = scheduler.schedule("blocker", async () => blocker.promise);
  const queued = scheduler.schedule("queued", async () => { queuedRan = true; return 1; });
  const cancelledQueued = scheduler.cancel("queued");
  blocker.resolve();
  const queuedResult = await settled(queued);
  await queuedBlocker;
  await scheduler.drain();
  assert.equal(cancelledRunning, true);
  assert.equal(aborted, true);
  assert.equal(firstResult.status, "rejected");
  assert.equal(duplicateResult.status, "rejected");
  assert.deepEqual(attempts, [1]);
  assert.equal(reused, "reused");
  assert.equal(cancelledQueued, true);
  assert.equal(queuedResult.status, "rejected");
  assert.equal(queuedRan, false);
});

test("canonical scheduler acceptance: retries, drain, and final errors are deterministic", async () => {
  const scheduler = new TaskScheduler({ concurrency: 2, maxAttempts: 2 });
  const blocker = deferred(), starts = [], active = { value: 0, maximum: 0 };
  const hold = scheduler.schedule("hold", async () => { active.maximum = Math.max(active.maximum, ++active.value); try { return await blocker.promise; } finally { active.value--; } });
  let retryAttempts = 0;
  const retry = scheduler.schedule("retry", async ({ attempt }) => {
    starts.push(attempt); active.maximum = Math.max(active.maximum, ++active.value);
    try { retryAttempts = attempt; if (attempt === 1) throw new Error("retry once"); return "retried"; } finally { active.value--; }
  });
  const drain = scheduler.drain();
  const retryResult = await settled(retry);
  let drained = false; void drain.then(() => { drained = true; });
  blocker.resolve("held"); await hold; await drain;

  let finalAttempts = 0;
  const final = scheduler.schedule("final", async ({ attempt }) => { finalAttempts = attempt; throw new Error("final task error"); });
  const finalResult = await settled(final);
  await scheduler.drain();
  assert.equal(retryResult.status, "fulfilled");
  assert.deepEqual(starts, [1, 2]);
  assert.equal(retryAttempts, 2);
  assert.equal(active.maximum, 2);
  assert.equal(drained, true);
  assert.equal(finalResult.status, "rejected");
  assert.match(String(finalResult.reason), /final task error/);
  assert.equal(finalAttempts, 2);
});
