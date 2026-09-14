import test from 'node:test';
import assert from 'node:assert/strict';

import { runWithConcurrency } from '../public/lib/queue.js';

/** Resolves after a turn of the event loop, so overlap is observable. */
function tick(ms = 1) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

test('processes every item exactly once', async () => {
  const items = ['a', 'b', 'c', 'd', 'e'];
  const seen = [];

  await runWithConcurrency(items, 2, async (item) => {
    await tick();
    seen.push(item);
  });

  assert.equal(seen.length, items.length);
  assert.deepEqual([...seen].sort(), [...items].sort());
});

test('never exceeds the concurrency limit', async () => {
  let inFlight = 0;
  let peak = 0;

  await runWithConcurrency(Array.from({ length: 12 }, (_, i) => i), 3, async () => {
    inFlight += 1;
    peak = Math.max(peak, inFlight);
    await tick(2);
    inFlight -= 1;
  });

  assert.ok(peak <= 3, `peak concurrency was ${peak}`);
  assert.equal(peak, 3, 'should actually use the whole budget');
});

test('runs strictly in order at a limit of one', async () => {
  const order = [];

  await runWithConcurrency([1, 2, 3, 4], 1, async (item) => {
    order.push(`start ${item}`);
    await tick();
    order.push(`end ${item}`);
  });

  assert.deepEqual(order, [
    'start 1', 'end 1',
    'start 2', 'end 2',
    'start 3', 'end 3',
    'start 4', 'end 4',
  ]);
});

test('a worker that throws does not stop the others', async () => {
  // One unreadable page must never take down the batch (spec section 6).
  const done = [];

  await runWithConcurrency([1, 2, 3, 4], 2, async (item) => {
    if (item === 2) throw new Error('this page failed');
    await tick();
    done.push(item);
  });

  assert.deepEqual(done.sort(), [1, 3, 4]);
});

test('stops scheduling once the signal is aborted', async () => {
  const controller = new AbortController();
  const started = [];

  const run = runWithConcurrency(Array.from({ length: 20 }, (_, i) => i), 2, async (item) => {
    started.push(item);
    await tick(5);
  }, { signal: controller.signal });

  await tick(12);
  controller.abort();
  await run;

  assert.ok(started.length < 20, `expected an early stop, started ${started.length}`);
  assert.ok(started.length > 0, 'should have started some work before aborting');
});

test('does nothing for an empty list', async () => {
  let called = false;
  await runWithConcurrency([], 3, async () => {
    called = true;
  });
  assert.equal(called, false);
});

test('treats a nonsense limit as one worker rather than none', async () => {
  const seen = [];
  for (const limit of [0, -1, Number.NaN]) {
    seen.length = 0;
    await runWithConcurrency([1, 2], limit, async (item) => {
      seen.push(item);
    });
    assert.deepEqual(seen, [1, 2], `limit ${limit} should still process everything`);
  }
});

test('never starts more workers than there are items', async () => {
  let peak = 0;
  let inFlight = 0;

  await runWithConcurrency([1, 2], 10, async () => {
    inFlight += 1;
    peak = Math.max(peak, inFlight);
    await tick();
    inFlight -= 1;
  });

  assert.equal(peak, 2);
});
