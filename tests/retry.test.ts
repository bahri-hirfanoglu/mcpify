import { describe, it, expect } from 'vitest';
import {
  shouldRetry,
  parseRetryAfter,
  computeBackoff,
  withRetry,
} from '../src/runtime/retry.js';

describe('shouldRetry', () => {
  it('retries on 429', () => {
    expect(shouldRetry(429)).toBe(true);
  });

  it('retries on 5xx', () => {
    expect(shouldRetry(500)).toBe(true);
    expect(shouldRetry(502)).toBe(true);
    expect(shouldRetry(599)).toBe(true);
  });

  it('does not retry on 4xx other than 429', () => {
    expect(shouldRetry(400)).toBe(false);
    expect(shouldRetry(401)).toBe(false);
    expect(shouldRetry(404)).toBe(false);
  });

  it('does not retry on 2xx/3xx', () => {
    expect(shouldRetry(200)).toBe(false);
    expect(shouldRetry(301)).toBe(false);
  });
});

describe('parseRetryAfter', () => {
  it('parses numeric seconds', () => {
    expect(parseRetryAfter('5')).toBe(5000);
    expect(parseRetryAfter('0')).toBe(0);
  });

  it('parses HTTP date', () => {
    const now = Date.UTC(2024, 0, 1, 0, 0, 0);
    const date = new Date(now + 10_000).toUTCString();
    expect(parseRetryAfter(date, now)).toBe(10_000);
  });

  it('returns 0 for past dates', () => {
    const now = Date.UTC(2024, 0, 1, 0, 0, 0);
    const past = new Date(now - 5000).toUTCString();
    expect(parseRetryAfter(past, now)).toBe(0);
  });

  it('returns undefined for null or invalid', () => {
    expect(parseRetryAfter(null)).toBeUndefined();
    expect(parseRetryAfter('')).toBeUndefined();
    expect(parseRetryAfter('not a date')).toBeUndefined();
  });
});

describe('computeBackoff', () => {
  const opts = { retries: 3, baseDelayMs: 100, maxDelayMs: 10_000 };

  it('grows exponentially', () => {
    const a0 = computeBackoff(0, opts, () => 0);
    const a1 = computeBackoff(1, opts, () => 0);
    const a2 = computeBackoff(2, opts, () => 0);
    expect(a1).toBeGreaterThanOrEqual(a0);
    expect(a2).toBeGreaterThanOrEqual(a1);
  });

  it('caps at maxDelayMs', () => {
    const big = computeBackoff(20, opts, () => 1);
    expect(big).toBeLessThanOrEqual(opts.maxDelayMs);
  });
});

describe('withRetry', () => {
  it('stops on first non-retryable result', async () => {
    let calls = 0;
    const result = await withRetry(
      async () => {
        calls++;
        return { result: 'ok', retryable: false };
      },
      { retries: 3, baseDelayMs: 1, maxDelayMs: 1 },
    );
    expect(result).toBe('ok');
    expect(calls).toBe(1);
  });

  it('retries up to retries+1 times', async () => {
    let calls = 0;
    const result = await withRetry(
      async () => {
        calls++;
        return { result: 'fail', retryable: true };
      },
      { retries: 2, baseDelayMs: 1, maxDelayMs: 1 },
    );
    expect(result).toBe('fail');
    expect(calls).toBe(3);
  });

  it('uses retryAfterMs when provided', async () => {
    let calls = 0;
    const start = Date.now();
    await withRetry(
      async () => {
        calls++;
        if (calls < 2) return { result: 'fail', retryable: true, retryAfterMs: 20 };
        return { result: 'ok', retryable: false };
      },
      { retries: 3, baseDelayMs: 1000, maxDelayMs: 5000 },
    );
    const elapsed = Date.now() - start;
    expect(elapsed).toBeGreaterThanOrEqual(15);
    expect(elapsed).toBeLessThan(500);
  });
});
