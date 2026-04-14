export interface RetryOptions {
  retries: number;
  baseDelayMs: number;
  maxDelayMs: number;
}

export const DEFAULT_RETRY: RetryOptions = {
  retries: 0,
  baseDelayMs: 500,
  maxDelayMs: 10_000,
};

export function shouldRetry(status: number): boolean {
  return status === 429 || (status >= 500 && status <= 599);
}

export function parseRetryAfter(headerValue: string | null, now: number = Date.now()): number | undefined {
  if (!headerValue) return undefined;
  const trimmed = headerValue.trim();
  if (trimmed === '') return undefined;

  if (/^\d+$/.test(trimmed)) {
    const seconds = parseInt(trimmed, 10);
    if (!Number.isFinite(seconds) || seconds < 0) return undefined;
    return seconds * 1000;
  }

  const date = Date.parse(trimmed);
  if (Number.isNaN(date)) return undefined;
  const delta = date - now;
  return delta > 0 ? delta : 0;
}

export function computeBackoff(attempt: number, opts: RetryOptions, jitterFn: () => number = Math.random): number {
  const exp = opts.baseDelayMs * Math.pow(2, attempt);
  const capped = Math.min(exp, opts.maxDelayMs);
  const jitter = jitterFn() * capped;
  return Math.floor(capped / 2 + jitter / 2);
}

export async function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  if (ms <= 0) return;
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    if (signal) {
      const onAbort = () => {
        clearTimeout(timer);
        reject(new Error('aborted'));
      };
      if (signal.aborted) onAbort();
      else signal.addEventListener('abort', onAbort, { once: true });
    }
  });
}

export async function withRetry<T>(
  fn: (attempt: number) => Promise<{ result: T; retryable: boolean; retryAfterMs?: number }>,
  opts: RetryOptions,
): Promise<T> {
  let lastResult: T | undefined;
  for (let attempt = 0; attempt <= opts.retries; attempt++) {
    const { result, retryable, retryAfterMs } = await fn(attempt);
    lastResult = result;
    if (!retryable || attempt === opts.retries) return result;

    const backoff = computeBackoff(attempt, opts);
    const delay = retryAfterMs ?? backoff;
    await sleep(Math.min(delay, opts.maxDelayMs));
  }
  return lastResult as T;
}
