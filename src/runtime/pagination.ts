export interface PaginationOptions {
  enabled: boolean;
  maxPages: number;
}

export const DEFAULT_PAGINATION: PaginationOptions = {
  enabled: false,
  maxPages: 10,
};

export function parseLinkHeader(header: string | null): Record<string, string> {
  if (!header) return {};
  const result: Record<string, string> = {};
  const parts = header.split(',');
  for (const part of parts) {
    const match = part.match(/<([^>]+)>\s*;\s*rel\s*=\s*"?([^";]+)"?/i);
    if (match) {
      const [, url, rel] = match;
      result[rel.trim().toLowerCase()] = url.trim();
    }
  }
  return result;
}

export function findNextUrlFromBody(body: unknown, currentUrl: string): string | undefined {
  if (!body || typeof body !== 'object') return undefined;

  const candidates = [
    'next', 'nextUrl', 'next_url', 'nextPage', 'next_page', 'nextPageUrl',
  ];

  const obj = body as Record<string, unknown>;
  for (const key of candidates) {
    const val = obj[key];
    if (typeof val === 'string' && val.length > 0) {
      try {
        return new URL(val, currentUrl).toString();
      } catch {
        continue;
      }
    }
  }

  const links = obj['links'];
  if (links && typeof links === 'object') {
    const nextLink = (links as Record<string, unknown>)['next'];
    if (typeof nextLink === 'string') {
      try {
        return new URL(nextLink, currentUrl).toString();
      } catch {
        return undefined;
      }
    }
    if (nextLink && typeof nextLink === 'object') {
      const href = (nextLink as Record<string, unknown>)['href'];
      if (typeof href === 'string') {
        try {
          return new URL(href, currentUrl).toString();
        } catch {
          return undefined;
        }
      }
    }
  }

  return undefined;
}

export function findNextCursorFromBody(body: unknown): string | undefined {
  if (!body || typeof body !== 'object') return undefined;
  const obj = body as Record<string, unknown>;
  const keys = ['nextCursor', 'next_cursor', 'cursor', 'nextToken', 'next_token'];
  for (const k of keys) {
    const v = obj[k];
    if (typeof v === 'string' && v.length > 0) return v;
  }
  return undefined;
}

export function applyCursorToUrl(url: string, cursor: string): string {
  const u = new URL(url);
  const existing = ['cursor', 'next_cursor', 'nextCursor', 'page_token', 'pageToken'];
  for (const name of existing) {
    if (u.searchParams.has(name)) {
      u.searchParams.set(name, cursor);
      return u.toString();
    }
  }
  u.searchParams.set('cursor', cursor);
  return u.toString();
}

export function mergePages(pages: unknown[]): unknown {
  if (pages.length === 0) return [];
  if (pages.length === 1) return pages[0];

  const first = pages[0];

  if (Array.isArray(first)) {
    const out: unknown[] = [];
    for (const page of pages) {
      if (Array.isArray(page)) out.push(...page);
    }
    return out;
  }

  if (first && typeof first === 'object') {
    const obj = first as Record<string, unknown>;
    const arrayKey = findPrimaryArrayKey(obj);
    if (arrayKey) {
      const merged: unknown[] = [];
      for (const page of pages) {
        const pageObj = page as Record<string, unknown>;
        const arr = pageObj[arrayKey];
        if (Array.isArray(arr)) merged.push(...arr);
      }
      return { ...obj, [arrayKey]: merged };
    }
  }

  return pages;
}

function findPrimaryArrayKey(obj: Record<string, unknown>): string | undefined {
  const preferred = ['data', 'items', 'results', 'records', 'entries', 'nodes'];
  for (const k of preferred) {
    if (Array.isArray(obj[k])) return k;
  }
  for (const [k, v] of Object.entries(obj)) {
    if (Array.isArray(v)) return k;
  }
  return undefined;
}
