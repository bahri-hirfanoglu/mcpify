import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { executeRequest } from '../src/runtime/http-client.js';
import type { ParsedOperation, AuthConfig } from '../src/types.js';
import { TokenManager } from '../src/auth/oauth.js';

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

describe('executeRequest', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should substitute path parameters', async () => {
    const mockFetch = vi.mocked(fetch);
    mockFetch.mockResolvedValue(
      new Response(JSON.stringify({ id: '123' }), {
        headers: { 'content-type': 'application/json' },
      }),
    );

    const op = makeOp({
      path: '/pets/{petId}',
      parameters: [
        { name: 'petId', in: 'path', required: true, schema: { type: 'string' } },
      ],
    });

    await executeRequest(op, { petId: '123' }, 'https://api.example.com', noAuth);

    expect(mockFetch).toHaveBeenCalledWith(
      'https://api.example.com/pets/123',
      expect.objectContaining({ method: 'GET' }),
    );
  });

  it('should add query parameters', async () => {
    const mockFetch = vi.mocked(fetch);
    mockFetch.mockResolvedValue(
      new Response('[]', {
        headers: { 'content-type': 'application/json' },
      }),
    );

    const op = makeOp({
      parameters: [
        { name: 'limit', in: 'query', required: false, schema: { type: 'integer' } },
      ],
    });

    await executeRequest(op, { limit: 10 }, 'https://api.example.com', noAuth);

    const calledUrl = mockFetch.mock.calls[0][0] as string;
    expect(calledUrl).toContain('limit=10');
  });

  it('should send JSON body', async () => {
    const mockFetch = vi.mocked(fetch);
    mockFetch.mockResolvedValue(
      new Response('{}', {
        headers: { 'content-type': 'application/json' },
      }),
    );

    const op = makeOp({
      method: 'POST',
      requestBody: {
        required: true,
        contentType: 'application/json',
        schema: { type: 'object' },
      },
    });

    await executeRequest(
      op,
      { _body: { name: 'Rex' } },
      'https://api.example.com',
      noAuth,
    );

    const callArgs = mockFetch.mock.calls[0][1]!;
    expect(callArgs.body).toBe('{"name":"Rex"}');
  });

  it('should apply auth headers', async () => {
    const mockFetch = vi.mocked(fetch);
    mockFetch.mockResolvedValue(
      new Response('{}', {
        headers: { 'content-type': 'application/json' },
      }),
    );

    const auth: AuthConfig = { type: 'bearer', token: 'mytoken' };
    await executeRequest(makeOp(), {}, 'https://api.example.com', auth);

    const callArgs = mockFetch.mock.calls[0][1]!;
    const headers = callArgs.headers as Record<string, string>;
    expect(headers['Authorization']).toBe('Bearer mytoken');
  });

  it('should handle error responses', async () => {
    const mockFetch = vi.mocked(fetch);
    mockFetch.mockResolvedValue(
      new Response('Not Found', { status: 404 }),
    );

    const result = await executeRequest(
      makeOp(),
      {},
      'https://api.example.com',
      noAuth,
    );

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('404');
  });

  it('should handle network errors', async () => {
    const mockFetch = vi.mocked(fetch);
    mockFetch.mockRejectedValue(new Error('ECONNREFUSED'));

    const result = await executeRequest(
      makeOp(),
      {},
      'https://api.example.com',
      noAuth,
    );

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('ECONNREFUSED');
  });

  it('should truncate large responses', async () => {
    const mockFetch = vi.mocked(fetch);
    const largeBody = 'x'.repeat(1000);
    mockFetch.mockResolvedValue(
      new Response(largeBody, {
        headers: { 'content-type': 'text/plain' },
      }),
    );

    const result = await executeRequest(
      makeOp(),
      {},
      'https://api.example.com',
      noAuth,
      500,
    );

    expect(result.content[0].text).toContain('...[truncated]');
    expect(result.content[0].text.length).toBeLessThan(600);
  });

  it('should apply oauth2 bearer token via TokenManager', async () => {
    const mockFetch = vi.mocked(fetch);
    mockFetch
      // First call: token endpoint
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ access_token: 'oauth-at', expires_in: 3600 }),
          { headers: { 'content-type': 'application/json' } },
        ),
      )
      // Second call: actual API request
      .mockResolvedValueOnce(
        new Response('{}', {
          headers: { 'content-type': 'application/json' },
        }),
      );

    const tm = new TokenManager({
      flow: 'client_credentials',
      tokenUrl: 'https://auth.example.com/token',
      clientId: 'cid',
      clientSecret: 'secret',
    });
    const auth: AuthConfig = { type: 'oauth2', tokenManager: tm };

    await executeRequest(makeOp(), {}, 'https://api.example.com', auth);

    // The second fetch call is the actual API request
    const apiCall = mockFetch.mock.calls[1];
    const apiHeaders = (apiCall[1] as RequestInit).headers as Record<string, string>;
    expect(apiHeaders['Authorization']).toBe('Bearer oauth-at');
  });

  it('should format JSON responses', async () => {
    const mockFetch = vi.mocked(fetch);
    mockFetch.mockResolvedValue(
      new Response('{"a":1}', {
        headers: { 'content-type': 'application/json' },
      }),
    );

    const result = await executeRequest(
      makeOp(),
      {},
      'https://api.example.com',
      noAuth,
    );

    expect(result.content[0].text).toBe('{\n  "a": 1\n}');
  });
});
