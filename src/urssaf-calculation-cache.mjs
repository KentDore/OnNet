/**
 * Owns the result and error caches used by the Urssaf calculation flow.
 * Successful results use bounded FIFO eviction; error entries are kept
 * separately so a failed request never masquerades as a successful result.
 */
export function createUrssafCalculationCache(options = {}){
  const maxResults = options.maxResults ?? 100;
  if(!Number.isInteger(maxResults) || maxResults < 1){
    throw new RangeError('maxResults doit être un entier strictement positif.');
  }

  const results = new Map();
  const errors = new Map();

  return Object.freeze({
    getResult(key){
      return results.get(key) ?? null;
    },
    hasResult(key){
      return results.has(key);
    },
    setResult(key, value){
      if(!results.has(key) && results.size >= maxResults){
        const oldestKey = results.keys().next().value;
        results.delete(oldestKey);
      }
      results.set(key, value);
    },
    getError(key){
      return errors.get(key) ?? null;
    },
    hasError(key){
      return errors.has(key);
    },
    setError(key, message){
      errors.set(key, message);
    },
    deleteError(key){
      return errors.delete(key);
    }
  });
}
