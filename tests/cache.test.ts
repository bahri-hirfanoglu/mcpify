import { describe, it, expect } from 'vitest';
import { ResponseCache, cacheKey } from '../src/runtime/cache.js';

describe('ResponseCache', () => {
  it('returns undefined when disabled', () => {
    const cache = new ResponseCache({ ttlMs: 0, maxEntries: 10 });
    cache.set('a', 'v');
    expect(cache.get('a')).toBeUndefined();
  });

  it('stores and retrieves within TTL', () => {
    const cache = new ResponseCache({ ttlMs: 1000, maxEntries: 10 });
    cache.set('a', 'v', 0);
    expect(cache.get('a', 500)).toBe('v');
  });

  it('expires after TTL', () => {
    const cache = new ResponseCache({ ttlMs: 1000, maxEntries: 10 });
    cache.set('a', 'v', 0);
    expect(cache.get('a', 2000)).toBeUndefined();
  });

  it('enforces max entries (LRU)', () => {
    const cache = new ResponseCache({ ttlMs: 10_000, maxEntries: 2 });
    cache.set('a', '1', 0);
    cache.set('b', '2', 0);
    cache.set('c', '3', 0);
    expect(cache.get('a', 0)).toBeUndefined();
    expect(cache.get('b', 0)).toBe('2');
    expect(cache.get('c', 0)).toBe('3');
  });

  it('promotes entry on get', () => {
    const cache = new ResponseCache({ ttlMs: 10_000, maxEntries: 2 });
    cache.set('a', '1', 0);
    cache.set('b', '2', 0);
    cache.get('a', 0); // promote a
    cache.set('c', '3', 0); // evicts b
    expect(cache.get('a', 0)).toBe('1');
    expect(cache.get('b', 0)).toBeUndefined();
  });

  it('clear empties the cache', () => {
    const cache = new ResponseCache({ ttlMs: 10_000, maxEntries: 10 });
    cache.set('a', 'v', 0);
    cache.clear();
    expect(cache.get('a', 0)).toBeUndefined();
    expect(cache.size).toBe(0);
  });
});

describe('cacheKey', () => {
  it('includes method url and auth', () => {
    const k1 = cacheKey('GET', 'https://x/a', { Authorization: 'Bearer 1' });
    const k2 = cacheKey('GET', 'https://x/a', { Authorization: 'Bearer 2' });
    expect(k1).not.toBe(k2);
  });

  it('normalizes case of method', () => {
    const k1 = cacheKey('get', 'https://x/a', {});
    const k2 = cacheKey('GET', 'https://x/a', {});
    expect(k1).toBe(k2);
  });
});
