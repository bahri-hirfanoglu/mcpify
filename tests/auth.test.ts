import { describe, it, expect, beforeEach } from 'vitest';
import { applyAuth, resolveAuth } from '../src/auth/handler.js';
import type { AuthConfig, ParsedSpec } from '../src/types.js';

describe('applyAuth', () => {
  it('should add bearer token header', () => {
    const headers: Record<string, string> = {};
    applyAuth(headers, { type: 'bearer', token: 'abc123' });
    expect(headers['Authorization']).toBe('Bearer abc123');
  });

  it('should add api key header', () => {
    const headers: Record<string, string> = {};
    applyAuth(headers, {
      type: 'api-key',
      headerName: 'X-API-Key',
      value: 'secret',
    });
    expect(headers['X-API-Key']).toBe('secret');
  });

  it('should not add anything for none auth', () => {
    const headers: Record<string, string> = {};
    applyAuth(headers, { type: 'none' });
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
});
