import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { resolve } from 'node:path';
import { runTest } from '../src/commands/test.js';

const V1 = resolve(__dirname, 'fixtures/minimal-v1.json');

describe('runTest', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('probes safe GET operations and skips unsafe', async () => {
    const mockFetch = vi.mocked(fetch);
    mockFetch.mockResolvedValue(new Response('{}', { status: 200 }));

    const report = await runTest(V1, { baseUrl: 'https://api.example.com' });

    const health = report.results.find((r) => r.operationId === 'healthCheck');
    expect(health?.status).toBe('ok');

    const item = report.results.find((r) => r.operationId === 'getItem');
    expect(item?.status).toBe('skipped');
    expect(item?.reason).toMatch(/parameters/);
  });

  it('reports failures on non-2xx', async () => {
    const mockFetch = vi.mocked(fetch);
    mockFetch.mockResolvedValue(new Response('nope', { status: 500 }));

    const report = await runTest(V1, { baseUrl: 'https://api.example.com' });
    const health = report.results.find((r) => r.operationId === 'healthCheck');
    expect(health?.status).toBe('fail');
    expect(health?.httpStatus).toBe(500);
    expect(report.fail).toBeGreaterThan(0);
  });

  it('reports network errors as failures', async () => {
    const mockFetch = vi.mocked(fetch);
    mockFetch.mockRejectedValue(new Error('ECONNREFUSED'));

    const report = await runTest(V1, { baseUrl: 'https://api.example.com' });
    const health = report.results.find((r) => r.operationId === 'healthCheck');
    expect(health?.status).toBe('fail');
    expect(health?.reason).toContain('ECONNREFUSED');
  });

  it('filters by only option', async () => {
    const mockFetch = vi.mocked(fetch);
    mockFetch.mockResolvedValue(new Response('{}', { status: 200 }));

    const report = await runTest(V1, {
      baseUrl: 'https://api.example.com',
      filterIds: ['healthCheck'],
    });

    const health = report.results.find((r) => r.operationId === 'healthCheck');
    const legacy = report.results.find((r) => r.operationId === 'legacy');
    expect(health?.status).toBe('ok');
    expect(legacy?.status).toBe('skipped');
  });

  it('sends custom headers and bearer token', async () => {
    const mockFetch = vi.mocked(fetch);
    mockFetch.mockResolvedValue(new Response('{}', { status: 200 }));

    await runTest(V1, {
      baseUrl: 'https://api.example.com',
      auth: { bearerToken: 'abc' },
      customHeaders: { 'X-Trace': '1' },
      filterIds: ['healthCheck'],
    });

    const call = mockFetch.mock.calls.find(([u]) => String(u).includes('/health'));
    const headers = (call![1] as RequestInit).headers as Record<string, string>;
    expect(headers['Authorization']).toBe('Bearer abc');
    expect(headers['X-Trace']).toBe('1');
  });
});
