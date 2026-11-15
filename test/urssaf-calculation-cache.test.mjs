import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createUrssafCalculationCache } from '../src/urssaf-calculation-cache.mjs';

test('stores and retrieves successful results without exposing the internal map', () => {
  const cache = createUrssafCalculationCache();
  const result = { net:2300, engine:'urssaf' };

  assert.equal(cache.getResult('missing'), null);
  assert.equal(cache.hasResult('salary-a'), false);
  cache.setResult('salary-a', result);
  assert.equal(cache.hasResult('salary-a'), true);
  assert.equal(cache.getResult('salary-a'), result);
  assert.equal('results' in cache, false);
});

test('evicts the oldest inserted result when the configured capacity is reached', () => {
  const cache = createUrssafCalculationCache({ maxResults:2 });
  cache.setResult('a', { value:1 });
  cache.setResult('b', { value:2 });
  // Updating an existing entry must not turn FIFO into LRU.
  cache.setResult('a', { value:10 });
  cache.setResult('c', { value:3 });

  assert.equal(cache.getResult('a'), null);
  assert.deepEqual(cache.getResult('b'), { value:2 });
  assert.deepEqual(cache.getResult('c'), { value:3 });
});

test('keeps errors separate from successful results and supports retry cleanup', () => {
  const cache = createUrssafCalculationCache();
  const result = { net:2300 };

  cache.setResult('scenario', result);
  cache.setError('scenario', 'Service indisponible');

  assert.equal(cache.hasError('scenario'), true);
  assert.equal(cache.getError('scenario'), 'Service indisponible');
  assert.equal(cache.getResult('scenario'), result);

  assert.equal(cache.deleteError('scenario'), true);
  assert.equal(cache.deleteError('scenario'), false);
  assert.equal(cache.hasError('scenario'), false);
  assert.equal(cache.getResult('scenario'), result);
});

test('uses a default result capacity of 100 while keeping error entries independent', () => {
  const cache = createUrssafCalculationCache();
  for(let index=0;index<101;index++){
    cache.setResult(String(index), { index });
  }
  cache.setError('old-error', 'Network failure');

  assert.equal(cache.getResult('0'), null);
  assert.deepEqual(cache.getResult('1'), { index:1 });
  assert.deepEqual(cache.getResult('100'), { index:100 });
  assert.equal(cache.getError('old-error'), 'Network failure');
});

test('creates independent cache instances and validates result capacity', () => {
  const first = createUrssafCalculationCache({ maxResults:2 });
  const second = createUrssafCalculationCache({ maxResults:2 });
  first.setResult('only-first', { value:1 });
  first.setError('only-first', 'error');

  assert.equal(second.getResult('only-first'), null);
  assert.equal(second.getError('only-first'), null);

  for(const maxResults of [0, -1, 1.5, NaN, Infinity]){
    assert.throws(
      () => createUrssafCalculationCache({ maxResults }),
      /maxResults/
    );
  }
});
