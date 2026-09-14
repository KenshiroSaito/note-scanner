/**
 * A bounded worker pool.
 *
 * Converting 25 images one at a time takes about twenty minutes on a local
 * model, which is what spec section 6 means by never blocking on the full set.
 * A few requests overlap instead, with the limit kept configurable because how
 * many a machine sustains before it degrades is a question to measure rather
 * than guess.
 *
 * Pure and DOM-free, so the properties that matter are actually testable.
 */

/**
 * Run `worker` over every item, at most `limit` at a time.
 *
 * The worker is responsible for its own failures: one unreadable page must not
 * stop the others (spec section 6), so a worker that throws is caught here and
 * the pool carries on.
 *
 * @template T
 * @param {T[]} items
 * @param {number} limit how many may be in flight at once
 * @param {(item: T, index: number) => Promise<void>} worker
 * @param {{ signal?: AbortSignal }} [options]
 * @returns {Promise<void>} resolves when every item has been handled or the run was aborted
 */
export async function runWithConcurrency(items, limit, worker, { signal } = {}) {
  const queue = [...items];
  if (queue.length === 0) return;

  // A shared cursor rather than chunking: a slow image must not hold up the
  // images behind it, which fixed batches would do.
  let next = 0;
  const workers = Math.max(1, Math.min(Math.floor(limit) || 1, queue.length));

  async function pull() {
    while (next < queue.length) {
      // Checked before claiming an item, so an aborted run schedules nothing more.
      if (signal?.aborted) return;

      const index = next;
      next += 1;

      try {
        await worker(queue[index], index);
      } catch (error) {
        // Swallowed on purpose: the worker owns its errors, and one failure
        // must not take the pool down with it.
        console.error('Queue worker failed', error);
      }
    }
  }

  await Promise.all(Array.from({ length: workers }, pull));
}
