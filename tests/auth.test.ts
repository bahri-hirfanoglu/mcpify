import { describe, it, expect, beforeEach } from 'vitest';
import { applyAuth, resolveAuth } from '../src/auth/handler.js';
import type { AuthConfig, ParsedSpec } from '../src/types.js';

describe('applyAuth', () => {
  it('should add bearer token header', async () => {
    const headers: Record<string, string> = {};
    await applyAuth(headers, { type: 'bearer', token: 'abc123' });
    expect(headers['Authorization']).toBe('Bearer abc123');
  });

  it('should add api key header', async () => {
    const headers: Record<string, string> = {};
    await applyAuth(headers, {
      type: 'api-key',
      headerName: 'X-API-Key',
      value: 'secret',
    });
    expect(headers['X-API-Key']).toBe('secret');
  });

  it('should not add anything for none auth', async () => {
    const headers: Record<string, string> = {};
    await applyAuth(headers, { type: 'none' });
    expect(Object.keys(headers)).toHaveLength(0);
  });
});

describe('resolveAuth', () => {
  const emptySpec: ParsedSpec = {
    title: 'Test',
    version: '1.0',
    defaultServerUrl: 'http://localhost',
    operations: [],
    securitySchemes: {},
  };

  beforeEach(() => {
    delete process.env.MCPIFY_BEARER_TOKEN;
    delete process.env.MCPIFY_API_KEY_HEADER;
    delete process.env.MCPIFY_API_KEY_VALUE;
    delete process.env.MCPIFY_OAUTH_CLIENT_ID;
    delete process.env.MCPIFY_OAUTH_CLIENT_SECRET;
    delete process.env.MCPIFY_OAUTH_REFRESH_TOKEN;
  });

  it('should use explicit bearer token', () => {
    const auth = resolveAuth({ bearerToken: 'tok' }, emptySpec);
    expect(auth).toEqual({ type: 'bearer', token: 'tok' });
  });

  it('should use explicit api key', () => {
    const auth = resolveAuth(
      { apiKeyHeader: 'X-Key', apiKeyValue: 'val' },
      emptySpec,
    );
    expect(auth).toEqual({
      type: 'api-key',
      headerName: 'X-Key',
      value: 'val',
    });
  });

  it('should fall back to env vars', () => {
    process.env.MCPIFY_BEARER_TOKEN = 'envtok';
    const auth = resolveAuth({}, emptySpec);
    expect(auth).toEqual({ type: 'bearer', token: 'envtok' });
  });

  it('should return none when nothing is configured', () => {
    const auth = resolveAuth({}, emptySpec);
    expect(auth).toEqual({ type: 'none' });
  });

  it('should build oauth2 auth from explicit options', () => {
    const auth = resolveAuth(
      {
        oauth: {
          flow: 'client_credentials',
          tokenUrl: 'https://auth.example.com/token',
          clientId: 'cid',
          clientSecret: 'secret',
        },
      },
      emptySpec,
    );
    expect(auth.type).toBe('oauth2');
  });

  it('should auto-detect oauth2 client_credentials from spec when env creds provided', () => {
    process.env.MCPIFY_OAUTH_CLIENT_ID = 'cid';
    process.env.MCPIFY_OAUTH_CLIENT_SECRET = 'secret';
    const spec: ParsedSpec = {
      ...emptySpec,
      securitySchemes: {
        oauth: {
          type: 'oauth2',
          flows: {
            clientCredentials: {
              tokenUrl: 'https://auth.example.com/token',
              scopes: { 'read:all': 'Read everything' },
            },
          },
        },
      },
    };
    const auth = resolveAuth({}, spec);
    expect(auth.type).toBe('oauth2');
  });

  it('should not auto-detect oauth2 without credentials', () => {
    const spec: ParsedSpec = {
      ...emptySpec,
      securitySchemes: {
        oauth: {
          type: 'oauth2',
          flows: {
            clientCredentials: {
              tokenUrl: 'https://auth.example.com/token',
              scopes: {},
            },
          },
        },
      },
    };
    const auth = resolveAuth({}, spec);
    expect(auth.type).toBe('none');
  });

  it('should auto-detect refresh_token flow from authorizationCode spec + env refresh token', () => {
    process.env.MCPIFY_OAUTH_REFRESH_TOKEN = 'rt-123';
    process.env.MCPIFY_OAUTH_CLIENT_ID = 'cid';
    const spec: ParsedSpec = {
      ...emptySpec,
      securitySchemes: {
        oauth: {
          type: 'oauth2',
          flows: {
            authorizationCode: {
              authorizationUrl: 'https://auth.example.com/authorize',
              tokenUrl: 'https://auth.example.com/token',
              scopes: { 'read': 'Read' },
            },
          },
        },
      },
    };
    const auth = resolveAuth({}, spec);
    expect(auth.type).toBe('oauth2');
  });
});
