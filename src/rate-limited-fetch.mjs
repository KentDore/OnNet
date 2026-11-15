/**
 * Creates a fetch wrapper that serializes requests and enforces a minimum
 * interval between request starts.
 *
 * The clock and wait function are injectable so scheduling behaviour can be
 * tested deterministically without browser timers or real network requests.
 */
export function createRateLimitedFetch(fetchImpl, options = {}){
  if(typeof fetchImpl !== 'function'){
    throw new TypeError('fetchImpl doit être une fonction.');
  }

  const minimumIntervalMs = options.minimumIntervalMs ?? 350;
  const now = options.now ?? Date.now;
  const wait = options.wait ?? (ms => new Promise(resolve => setTimeout(resolve, ms)));

  if(!Number.isFinite(minimumIntervalMs) || minimumIntervalMs < 0){
    throw new RangeError('minimumIntervalMs doit être un nombre positif ou nul.');
  }
  if(typeof now !== 'function'){
    throw new TypeError('now doit être une fonction.');
  }
  if(typeof wait !== 'function'){
    throw new TypeError('wait doit être une fonction.');
  }

  let queue = Promise.resolve();
  let lastRequestAt = null;

  return function rateLimitedFetch(url, init){
    const request = queue.then(async () => {
      if(lastRequestAt !== null){
        const delay = Math.max(0, minimumIntervalMs - (now() - lastRequestAt));
        if(delay > 0) await wait(delay);
      }
      lastRequestAt = now();
      return fetchImpl(url, init);
    });

    // A rejected request must not permanently poison the queue.
    queue = request.catch(() => {});
    return request;
  };
}
