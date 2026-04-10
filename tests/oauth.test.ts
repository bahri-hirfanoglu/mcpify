import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { TokenManager } from '../src/auth/oauth.js';

function jsonResponse(body: unknown, init?: ResponseInit): Response {
  return new Response(JSON.stringify(body), {
    ...init,
    headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) },
  });
}

describe('TokenManager', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('fetches token via client_credentials grant', async () => {
    const mock = vi.mocked(fetch);
    mock.mockResolvedValue(
      jsonResponse({ access_token: 'at-1', expires_in: 3600 }),
    );

    const tm = new TokenManager({
      flow: 'client_credentials',
      tokenUrl: 'https://auth.example.com/token',
      clientId: 'cid',
      clientSecret: 'secret',
      scopes: ['read', 'write'],
    });

    const token = await tm.getAccessToken();
    expect(token).toBe('at-1');
    expect(mock).toHaveBeenCalledTimes(1);

    const [url, init] = mock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://auth.example.com/token');
    expect(init.method).toBe('POST');
    const headers = init.headers as Record<string, string>;
    expect(headers['Content-Type']).toBe('application/x-www-form-urlencoded');
    // Basic auth: base64("cid:secret")
    expect(headers['Authorization']).toBe(
      `Basic ${Buffer.from('cid:secret').toString('base64')}`,
    );
    const body = String(init.body);
    expect(body).toContain('grant_type=client_credentials');
    expect(body).toContain('scope=read+write');
  });

  it('caches token and returns without refetching when fresh', async () => {
    const mock = vi.mocked(fetch);
    mock.mockResolvedValue(
      jsonResponse({ access_token: 'at-1', expires_in: 3600 }),
    );

    const tm = new TokenManager({
      flow: 'client_credentials',
      tokenUrl: 'https://auth.example.com/token',
      clientId: 'cid',
      clientSecret: 'secret',
    });

    await tm.getAccessToken();
    await tm.getAccessToken();
    await tm.getAccessToken();
    expect(mock).toHaveBeenCalledTimes(1);
  });

  it('refreshes when token is near expiry', async () => {
    const mock = vi.mocked(fetch);
    mock
      .mockResolvedValueOnce(
        jsonResponse({ access_token: 'at-1', expires_in: 1 }), // 1 sec → under skew
      )
      .mockResolvedValueOnce(
        jsonResponse({ access_token: 'at-2', expires_in: 3600 }),
      );

    const tm = new TokenManager({
      flow: 'client_credentials',
      tokenUrl: 'https://auth.example.com/token',
      clientId: 'cid',
      clientSecret: 'secret',
    });

    expect(await tm.getAccessToken()).toBe('at-1');
    expect(await tm.getAccessToken()).toBe('at-2');
    expect(mock).toHaveBeenCalledTimes(2);
  });

  it('uses refresh_token grant with refresh token', async () => {
    const mock = vi.mocked(fetch);
    mock.mockResolvedValue(
      jsonResponse({
        access_token: 'at-new',
        refresh_token: 'rt-new',
        expires_in: 3600,
      }),
    );

    const tm = new TokenManager({
      flow: 'refresh_token',
      tokenUrl: 'https://auth.example.com/token',
      clientId: 'cid',
      refreshToken: 'rt-old',
    });

    const token = await tm.getAccessToken();
    expect(token).toBe('at-new');
    const init = mock.mock.calls[0][1] as RequestInit;
    const body = String(init.body);
    expect(body).toContain('grant_type=refresh_token');
    expect(body).toContain('refresh_token=rt-old');
    // No secret → client_id goes in body
    expect(body).toContain('client_id=cid');
  });

  it('rotates refresh token from server response', async () => {
    const mock = vi.mocked(fetch);
    mock
      .mockResolvedValueOnce(
        jsonResponse({
          access_token: 'at-1',
          refresh_token: 'rt-rotated',
          expires_in: 1,
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({ access_token: 'at-2', expires_in: 3600 }),
      );

    const tm = new TokenManager({
      flow: 'refresh_token',
      tokenUrl: 'https://auth.example.com/token',
      clientId: 'cid',
      refreshToken: 'rt-initial',
    });

    await tm.getAccessToken();
    await tm.getAccessToken();

    const secondCallBody = String(
      (mock.mock.calls[1][1] as RequestInit).body,
    );
    expect(secondCallBody).toContain('refresh_token=rt-rotated');
  });

  it('throws when token endpoint returns non-2xx', async () => {
    const mock = vi.mocked(fetch);
    mock.mockResolvedValue(
      new Response('invalid_client', { status: 401 }),
    );

    const tm = new TokenManager({
      flow: 'client_credentials',
      tokenUrl: 'https://auth.example.com/token',
      clientId: 'bad',
      clientSecret: 'bad',
    });

    await expect(tm.getAccessToken()).rejects.toThrow(/401/);
  });

  it('throws when response has no access_token', async () => {
    const mock = vi.mocked(fetch);
    mock.mockResolvedValue(jsonResponse({ error: 'invalid' }));

    const tm = new TokenManager({
      flow: 'client_credentials',
      tokenUrl: 'https://auth.example.com/token',
      clientId: 'cid',
      clientSecret: 'secret',
    });

    await expect(tm.getAccessToken()).rejects.toThrow(/access_token/);
  });

  it('throws when refresh_token grant has no refresh token', async () => {
    const tm = new TokenManager({
      flow: 'refresh_token',
      tokenUrl: 'https://auth.example.com/token',
      clientId: 'cid',
    });

    await expect(tm.getAccessToken()).rejects.toThrow(/refresh token/i);
  });

  it('deduplicates concurrent token fetches', async () => {
    const mock = vi.mocked(fetch);
    mock.mockResolvedValue(
      jsonResponse({ access_token: 'at-1', expires_in: 3600 }),
    );

    const tm = new TokenManager({
      flow: 'client_credentials',
      tokenUrl: 'https://auth.example.com/token',
      clientId: 'cid',
      clientSecret: 'secret',
    });

    const [a, b, c] = await Promise.all([
      tm.getAccessToken(),
      tm.getAccessToken(),
      tm.getAccessToken(),
    ]);
    expect(a).toBe('at-1');
    expect(b).toBe('at-1');
    expect(c).toBe('at-1');
    expect(mock).toHaveBeenCalledTimes(1);
  });
});
