/**
 * Owns the result and error caches used by the Urssaf calculation flow.
 * Successful results and errors use independent bounded FIFO caches so
 * repeated failures for distinct scenarios cannot grow memory indefinitely.
 */
export function createUrssafCalculationCache(options = {}){
  const maxResults = options.maxResults ?? 100;
  const maxErrors = options.maxErrors ?? maxResults;
  if(!Number.isInteger(maxResults) || maxResults < 1){
    throw new RangeError('maxResults doit être un entier strictement positif.');
  }
  if(!Number.isInteger(maxErrors) || maxErrors < 1){
    throw new RangeError('maxErrors doit être un entier strictement positif.');
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
      if(!errors.has(key) && errors.size >= maxErrors){
        const oldestKey = errors.keys().next().value;
        errors.delete(oldestKey);
      }
      errors.set(key, message);
    },
    deleteError(key){
      return errors.delete(key);
    }
  });
}
