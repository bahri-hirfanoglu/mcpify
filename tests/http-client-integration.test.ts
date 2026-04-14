import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { executeRequest } from '../src/runtime/http-client.js';
import { ResponseCache } from '../src/runtime/cache.js';
import type { ParsedOperation, AuthConfig } from '../src/types.js';

function makeOp(overrides: Partial<ParsedOperation> = {}): ParsedOperation {
  return {
    operationId: 'test',
    method: 'GET',
    path: '/test',
    tags: [],
    parameters: [],
    security: [],
    servers: [],
    ...overrides,
  };
}

const noAuth: AuthConfig = { type: 'none' };

describe('executeRequest — retry', () => {
  beforeEach(() => vi.stubGlobal('fetch', vi.fn()));
  afterEach(() => vi.restoreAllMocks());

  it('retries on 500 and succeeds', async () => {
    const mockFetch = vi.mocked(fetch);
    mockFetch
      .mockResolvedValueOnce(new Response('boom', { status: 500 }))
      .mockResolvedValueOnce(new Response('{"ok":true}', {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }));

    const result = await executeRequest(makeOp(), {}, 'https://api.example.com', noAuth, {
      retry: { retries: 2, baseDelayMs: 1, maxDelayMs: 5 },
    });

    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect(result.isError).toBeUndefined();
    expect(result.content[0].text).toContain('"ok": true');
  });

  it('gives up after retries exhausted', async () => {
    const mockFetch = vi.mocked(fetch);
    mockFetch.mockResolvedValue(new Response('boom', { status: 503 }));

    const result = await executeRequest(makeOp(), {}, 'https://api.example.com', noAuth, {
      retry: { retries: 2, baseDelayMs: 1, maxDelayMs: 5 },
    });

    expect(mockFetch).toHaveBeenCalledTimes(3);
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('503');
  });

  it('respects Retry-After header (numeric)', async () => {
    const mockFetch = vi.mocked(fetch);
    mockFetch
      .mockResolvedValueOnce(new Response('limited', {
        status: 429,
        headers: { 'retry-after': '0' },
      }))
      .mockResolvedValueOnce(new Response('{}', {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }));

    const result = await executeRequest(makeOp(), {}, 'https://api.example.com', noAuth, {
      retry: { retries: 1, baseDelayMs: 1, maxDelayMs: 5 },
    });

    expect(result.isError).toBeUndefined();
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });
});

describe('executeRequest — cache', () => {
  beforeEach(() => vi.stubGlobal('fetch', vi.fn()));
  afterEach(() => vi.restoreAllMocks());

  it('returns cached response for repeated GET', async () => {
    const mockFetch = vi.mocked(fetch);
    mockFetch.mockResolvedValue(new Response('{"a":1}', {
      headers: { 'content-type': 'application/json' },
    }));

    const cache = new ResponseCache({ ttlMs: 60_000, maxEntries: 10 });

    const r1 = await executeRequest(makeOp(), {}, 'https://api.example.com', noAuth, { cache });
    const r2 = await executeRequest(makeOp(), {}, 'https://api.example.com', noAuth, { cache });

    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(r1.content[0].text).toBe(r2.content[0].text);
  });

  it('does not cache POST', async () => {
    const mockFetch = vi.mocked(fetch);
    mockFetch.mockResolvedValue(new Response('{}', {
      headers: { 'content-type': 'application/json' },
    }));

    const cache = new ResponseCache({ ttlMs: 60_000, maxEntries: 10 });
    const op = makeOp({ method: 'POST', requestBody: { required: true, contentType: 'application/json', schema: { type: 'object' } } });

    await executeRequest(op, { _body: { a: 1 } }, 'https://api.example.com', noAuth, { cache });
    await executeRequest(op, { _body: { a: 1 } }, 'https://api.example.com', noAuth, { cache });

    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it('does not cache error responses', async () => {
    const mockFetch = vi.mocked(fetch);
    mockFetch.mockResolvedValue(new Response('nope', { status: 500 }));

    const cache = new ResponseCache({ ttlMs: 60_000, maxEntries: 10 });

    await executeRequest(makeOp(), {}, 'https://api.example.com', noAuth, { cache });
    await executeRequest(makeOp(), {}, 'https://api.example.com', noAuth, { cache });

    expect(mockFetch).toHaveBeenCalledTimes(2);
  });
});

describe('executeRequest — pagination', () => {
  beforeEach(() => vi.stubGlobal('fetch', vi.fn()));
  afterEach(() => vi.restoreAllMocks());

  it('follows Link header and merges array pages', async () => {
    const mockFetch = vi.mocked(fetch);
    mockFetch
      .mockResolvedValueOnce(new Response(JSON.stringify([1, 2]), {
        headers: {
          'content-type': 'application/json',
          link: '<https://api.example.com/test?page=2>; rel="next"',
        },
      }))
      .mockResolvedValueOnce(new Response(JSON.stringify([3, 4]), {
        headers: { 'content-type': 'application/json' },
      }));

    const result = await executeRequest(makeOp(), {}, 'https://api.example.com', noAuth, {
      pagination: { enabled: true, maxPages: 5 },
    });

    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect(JSON.parse(result.content[0].text)).toEqual([1, 2, 3, 4]);
  });

  it('follows body next field and merges object pages', async () => {
    const mockFetch = vi.mocked(fetch);
    mockFetch
      .mockResolvedValueOnce(new Response(JSON.stringify({
        data: [{ id: 1 }],
        next: 'https://api.example.com/test?page=2',
      }), { headers: { 'content-type': 'application/json' } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        data: [{ id: 2 }],
      }), { headers: { 'content-type': 'application/json' } }));

    const result = await executeRequest(makeOp(), {}, 'https://api.example.com', noAuth, {
      pagination: { enabled: true, maxPages: 5 },
    });

    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.data).toEqual([{ id: 1 }, { id: 2 }]);
  });

  it('stops at maxPages', async () => {
    const mockFetch = vi.mocked(fetch);
    mockFetch.mockImplementation(async () =>
      new Response(JSON.stringify([1]), {
        headers: {
          'content-type': 'application/json',
          link: '<https://api.example.com/test?page=2>; rel="next"',
        },
      }),
    );

    const result = await executeRequest(makeOp(), {}, 'https://api.example.com', noAuth, {
      pagination: { enabled: true, maxPages: 2 },
    });

    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect(result.content[0].text).toContain('[paginated: stopped at max-pages=2]');
  });
});

describe('executeRequest — responseFields', () => {
  beforeEach(() => vi.stubGlobal('fetch', vi.fn()));
  afterEach(() => vi.restoreAllMocks());

  it('plucks requested fields from response', async () => {
    const mockFetch = vi.mocked(fetch);
    mockFetch.mockResolvedValue(new Response(JSON.stringify({
      items: [{ id: 1, name: 'a', secret: 's1' }, { id: 2, name: 'b', secret: 's2' }],
    }), { headers: { 'content-type': 'application/json' } }));

    const result = await executeRequest(makeOp(), {}, 'https://api.example.com', noAuth, {
      responseFields: ['items[].id', 'items[].name'],
    });

    const parsed = JSON.parse(result.content[0].text);
    expect(parsed).toEqual({ id: [1, 2], name: ['a', 'b'] });
    expect(result.content[0].text).not.toContain('secret');
  });
});
