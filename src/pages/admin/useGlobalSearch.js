import { useState, useEffect } from 'react';

// Tiny pub/sub store so the Topbar's universal search can drive search on
// whatever admin page is open (content-aware per-page filtering).
let term = '';
const listeners = new Set();

export function getGlobalSearch() {
  return term;
}

export function setGlobalSearch(next) {
  term = next;
  listeners.forEach((fn) => fn(term));
}

export function clearGlobalSearch() {
  setGlobalSearch('');
}

export function useGlobalSearch() {
  const [value, setValue] = useState(term);
  useEffect(() => {
    const fn = (v) => setValue(v);
    listeners.add(fn);
    return () => listeners.delete(fn);
  }, []);
  return value;
}