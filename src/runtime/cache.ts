export interface CacheOptions {
  ttlMs: number;
  maxEntries: number;
}

export interface CacheEntry {
  value: string;
  expiresAt: number;
}

export class ResponseCache {
  private store = new Map<string, CacheEntry>();
  private readonly ttlMs: number;
  private readonly maxEntries: number;

  constructor(opts: CacheOptions) {
    this.ttlMs = opts.ttlMs;
    this.maxEntries = opts.maxEntries;
  }

  get enabled(): boolean {
    return this.ttlMs > 0 && this.maxEntries > 0;
  }

  get size(): number {
    return this.store.size;
  }

  get(key: string, now: number = Date.now()): string | undefined {
    const entry = this.store.get(key);
    if (!entry) return undefined;
    if (entry.expiresAt <= now) {
      this.store.delete(key);
      return undefined;
    }
    this.store.delete(key);
    this.store.set(key, entry);
    return entry.value;
  }

  set(key: string, value: string, now: number = Date.now()): void {
    if (!this.enabled) return;
    if (this.store.has(key)) this.store.delete(key);
    this.store.set(key, { value, expiresAt: now + this.ttlMs });
    while (this.store.size > this.maxEntries) {
      const oldest = this.store.keys().next().value;
      if (oldest === undefined) break;
      this.store.delete(oldest);
    }
  }

  clear(): void {
    this.store.clear();
  }
}

export function cacheKey(method: string, url: string, headers: Record<string, string>): string {
  const authPart = headers['Authorization'] ?? headers['authorization'] ?? '';
  return `${method.toUpperCase()} ${url} ${authPart}`;
}
