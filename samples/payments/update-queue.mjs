/** Bounded intake with one active action per user and fair turns between users. */
export function createUserUpdateSink(
  consume,
  { concurrency = 4, maxPending = 128, onError = () => {}, onHandled = () => {} } = {},
) {
  if (
    typeof consume !== 'function' ||
    typeof onError !== 'function' ||
    typeof onHandled !== 'function' ||
    !Number.isSafeInteger(concurrency) ||
    concurrency < 1 ||
    !Number.isSafeInteger(maxPending) ||
    maxPending < concurrency
  )
    throw new Error('Invalid update queue configuration.');
  const users = new Map();
  const ready = [];
  const pending = new Map();
  const capacityWaiters = [];
  let active = 0;
  let nextId = 0;
  let halted = false;

  const available = () => maxPending - pending.size;
  function notifyCapacity() {
    const count = available();
    if (count > 0) for (const resolve of capacityWaiters.splice(0)) resolve(count);
  }
  function schedule() {
    while (!halted && active < concurrency && ready.length) {
      const key = ready.shift();
      const user = users.get(key);
      const task = user.items.shift();
      task.running = true;
      active++;
      Promise.resolve()
        .then(() => consume(task.update))
        // Only successful consumption may remove an update from the durable
        // inbox. An error handler logging the failure is not an acknowledgement.
        .then(() => onHandled(task.update))
        .catch(async (error) => {
          // Later actions must not overtake an update that will be replayed.
          // Stop scheduling, retain queued updates in the durable inbox, and
          // let only already-running users drain before the runner restarts.
          halted = true;
          ready.length = 0;
          for (const queuedUser of users.values()) queuedUser.items.length = 0;
          for (const [id, queued] of pending) if (!queued.running) pending.delete(id);
          notifyCapacity();
          try {
            await onError(error);
          } catch {}
          console.error('Обновление Telegram сохранено для восстановления после сбоя.');
        })
        .finally(() => {
          pending.delete(task.id);
          active--;
          if (user.items.length) ready.push(key);
          else users.delete(key);
          schedule();
          notifyCapacity();
        });
    }
  }
  return {
    handle(updates) {
      if (halted) return Promise.resolve(maxPending);
      for (const update of updates) {
        const id = Number.isSafeInteger(update.update_id)
          ? `telegram:${update.update_id}`
          : `local:${++nextId}`;
        if (pending.has(id)) continue;
        const userId = update.callback_query?.from?.id ?? update.message?.from?.id;
        const key = userId === undefined ? `update:${id}` : `user:${userId}`;
        let user = users.get(key);
        if (!user) {
          user = { items: [] };
          users.set(key, user);
          ready.push(key);
        }
        const task = { id, update };
        user.items.push(task);
        pending.set(id, task);
      }
      schedule();
      // Queued actions from a busy user do not consume execution slots. Only
      // the bounded total backlog applies backpressure to Telegram polling.
      return available() > 0
        ? Promise.resolve(available())
        : new Promise((resolve) => capacityWaiters.push(resolve));
    },
    size: () => pending.size,
    snapshot: () => [...pending.values()].map((task) => task.update),
  };
}
