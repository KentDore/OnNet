import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRateLimitedFetch } from '../src/rate-limited-fetch.mjs';

test('starts the first request immediately and spaces queued requests', async () => {
  let clock = 1000;
  const waits = [];
  const starts = [];
  const fetchImpl = async (url, init) => {
    starts.push({ url, init, at:clock });
    return { url, init };
  };
  const rateLimitedFetch = createRateLimitedFetch(fetchImpl, {
    minimumIntervalMs:350,
    now:() => clock,
    wait:async ms => {
      waits.push(ms);
      clock += ms;
    }
  });

  const firstOptions = { method:'POST', body:'first' };
  const [first, second, third] = await Promise.all([
    rateLimitedFetch('/first', firstOptions),
    rateLimitedFetch('/second', { method:'GET' }),
    rateLimitedFetch('/third', undefined)
  ]);

  assert.deepEqual(waits, [350, 350]);
  assert.deepEqual(starts.map(item => item.at), [1000, 1350, 1700]);
  assert.deepEqual(starts.map(item => item.url), ['/first', '/second', '/third']);
  assert.equal(starts[0].init, firstOptions);
  assert.deepEqual(first, { url:'/first', init:firstOptions });
  assert.deepEqual(second, { url:'/second', init:{ method:'GET' } });
  assert.deepEqual(third, { url:'/third', init:undefined });
});

test('does not wait when enough time elapsed before the next call', async () => {
  let clock = 2000;
  const waits = [];
  const starts = [];
  const rateLimitedFetch = createRateLimitedFetch(async url => {
    starts.push({ url, at:clock });
    return url;
  }, {
    minimumIntervalMs:350,
    now:() => clock,
    wait:async ms => {
      waits.push(ms);
      clock += ms;
    }
  });

  await rateLimitedFetch('/first');
  clock += 500;
  await rateLimitedFetch('/second');

  assert.deepEqual(waits, []);
  assert.deepEqual(starts, [
    { url:'/first', at:2000 },
    { url:'/second', at:2500 }
  ]);
});

test('continues processing after a rejected network request', async () => {
  let clock = 3000;
  let shouldFail = true;
  const waits = [];
  const starts = [];
  const rateLimitedFetch = createRateLimitedFetch(async url => {
    starts.push({ url, at:clock });
    if(shouldFail){
      shouldFail = false;
      throw new Error('network failure');
    }
    return { ok:true, url };
  }, {
    minimumIntervalMs:350,
    now:() => clock,
    wait:async ms => {
      waits.push(ms);
      clock += ms;
    }
  });

  await assert.rejects(rateLimitedFetch('/failure'), /network failure/);
  assert.deepEqual(await rateLimitedFetch('/recovered'), {
    ok:true, url:'/recovered'
  });

  assert.deepEqual(waits, [350]);
  assert.deepEqual(starts, [
    { url:'/failure', at:3000 },
    { url:'/recovered', at:3350 }
  ]);
});

test('validates injected dependencies and the minimum interval', () => {
  assert.throws(() => createRateLimitedFetch(null), /fetchImpl/);
  assert.throws(() => createRateLimitedFetch(async () => {}, {
    minimumIntervalMs:-1
  }), /minimumIntervalMs/);
  assert.throws(() => createRateLimitedFetch(async () => {}, {
    now:1
  }), /now/);
  assert.throws(() => createRateLimitedFetch(async () => {}, {
    wait:1
  }), /wait/);
});
