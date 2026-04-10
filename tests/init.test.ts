import { describe, it, expect, afterEach } from 'vitest';
import { mkdtemp, rm, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { runInit, collectConfig, type Prompter } from '../src/commands/init.js';

function mockPrompter(answers: string[], confirms: boolean[] = []): Prompter {
  let i = 0;
  let j = 0;
  return {
    async ask(): Promise<string> {
      return answers[i++] ?? '';
    },
    async confirm(): Promise<boolean> {
      return confirms[j++] ?? false;
    },
    close() {},
  };
}

describe('collectConfig', () => {
  it('collects minimal stdio config with no auth', async () => {
    const p = mockPrompter([
      './api.yaml', // spec
      'stdio', // transport
      '', // baseUrl
      'none', // auth
      '', // include
      '', // exclude
      '', // tags
      'original', // naming
      '', // prefix
    ], [
      false, // verbose
    ]);

    const config = await collectConfig(p);
    expect(config).toEqual({
      spec: './api.yaml',
      transport: 'stdio',
    });
  });

  it('collects http transport with port', async () => {
    const p = mockPrompter([
      'https://petstore.swagger.io/v2/swagger.json',
      'http',
      '8080',
      '',
      'none',
      '',
      '',
      '',
      'original',
      '',
    ], [false]);

    const config = await collectConfig(p);
    expect(config.transport).toBe('http');
    expect(config.port).toBe(8080);
    expect(config.spec).toBe('https://petstore.swagger.io/v2/swagger.json');
  });

  it('collects bearer auth', async () => {
    const p = mockPrompter([
      './api.yaml',
      'stdio',
      '',
      'bearer',
      'sk-test-123', // bearer token
      '',
      '',
      '',
      'original',
      '',
    ], [false]);

    const config = await collectConfig(p);
    expect(config.bearerToken).toBe('sk-test-123');
  });

  it('collects api-key auth', async () => {
    const p = mockPrompter([
      './api.yaml',
      'stdio',
      '',
      'api-key',
      'X-Custom-Key',
      'val-123',
      '',
      '',
      '',
      'original',
      '',
    ], [false]);

    const config = await collectConfig(p);
    expect(config.apiKeyHeader).toBe('X-Custom-Key');
    expect(config.apiKeyValue).toBe('val-123');
  });

  it('collects oauth2 client_credentials', async () => {
    const p = mockPrompter([
      './api.yaml',
      'stdio',
      '',
      'oauth2',
      'client_credentials', // flow
      'https://auth.example.com/token', // tokenUrl
      'cid', // clientId
      'secret', // clientSecret
      'read,write', // scopes
      '',
      '',
      '',
      'original',
      '',
    ], [false]);

    const config = await collectConfig(p);
    expect(config.oauth).toEqual({
      flow: 'client_credentials',
      tokenUrl: 'https://auth.example.com/token',
      clientId: 'cid',
      clientSecret: 'secret',
      scopes: ['read', 'write'],
    });
  });

  it('collects oauth2 refresh_token with prompt for refresh token', async () => {
    const p = mockPrompter([
      './api.yaml',
      'stdio',
      '',
      'oauth2',
      'refresh_token', // flow
      'https://auth.example.com/token',
      'cid',
      '', // no secret
      'rt-123', // refresh token
      '', // scopes
      '',
      '',
      '',
      'original',
      '',
    ], [false]);

    const config = await collectConfig(p);
    expect(config.oauth?.flow).toBe('refresh_token');
    expect(config.oauth?.refreshToken).toBe('rt-123');
  });

  it('collects filtering and naming options', async () => {
    const p = mockPrompter([
      './api.yaml',
      'stdio',
      '',
      'none',
      'get*, list*', // include
      'delete*', // exclude
      'pets, users', // tags
      'snake_case',
      'myapi_',
    ], [true]); // verbose

    const config = await collectConfig(p);
    expect(config.include).toEqual(['get*', 'list*']);
    expect(config.exclude).toEqual(['delete*']);
    expect(config.tags).toEqual(['pets', 'users']);
    expect(config.naming).toBe('snake_case');
    expect(config.prefix).toBe('myapi_');
    expect(config.verbose).toBe(true);
  });

  it('rejects invalid transport', async () => {
    const p = mockPrompter([
      './api.yaml',
      'websocket',
    ], []);
    await expect(collectConfig(p)).rejects.toThrow(/Invalid transport/);
  });

  it('rejects invalid auth type', async () => {
    const p = mockPrompter([
      './api.yaml',
      'stdio',
      '',
      'basic',
    ], []);
    await expect(collectConfig(p)).rejects.toThrow(/Invalid auth type/);
  });

  it('requires a spec source', async () => {
    const p = mockPrompter(['', ''], []);
    await expect(collectConfig(p)).rejects.toThrow(/spec is required/);
  });
});

describe('runInit', () => {
  let tmpDir: string;

  afterEach(async () => {
    if (tmpDir) await rm(tmpDir, { recursive: true, force: true });
  });

  it('writes config file to cwd', async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'mcpify-init-'));
    const p = mockPrompter([
      './api.yaml',
      'stdio',
      '',
      'none',
      '',
      '',
      '',
      'original',
      '',
    ], [false]);

    const result = await runInit(p, { cwd: tmpDir });
    expect(result.path).toBe(resolve(tmpDir, '.mcpifyrc.json'));

    const content = await readFile(result.path, 'utf-8');
    const parsed = JSON.parse(content);
    expect(parsed.spec).toBe('./api.yaml');
    expect(parsed.transport).toBe('stdio');
  });

  it('aborts when existing file and user declines overwrite', async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'mcpify-init-'));
    await writeFile(
      resolve(tmpDir, '.mcpifyrc.json'),
      '{"spec":"old.yaml"}',
    );

    const p = mockPrompter([], [false]); // decline overwrite
    await expect(runInit(p, { cwd: tmpDir })).rejects.toThrow(/Aborted/);

    const content = await readFile(resolve(tmpDir, '.mcpifyrc.json'), 'utf-8');
    expect(content).toBe('{"spec":"old.yaml"}');
  });

  it('overwrites when force is true', async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'mcpify-init-'));
    await writeFile(
      resolve(tmpDir, '.mcpifyrc.json'),
      '{"spec":"old.yaml"}',
    );

    const p = mockPrompter([
      './new.yaml',
      'stdio',
      '',
      'none',
      '',
      '',
      '',
      'original',
      '',
    ], [false]);

    const result = await runInit(p, { cwd: tmpDir, force: true });
    expect(result.config.spec).toBe('./new.yaml');
  });
});
