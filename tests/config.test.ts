import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { writeFile, unlink } from 'node:fs/promises';
import { resolve } from 'node:path';
import { loadConfig, mergeConfig } from '../src/config.js';

const testDir = resolve(import.meta.dirname, '..');

describe('loadConfig', () => {
  const configPath = resolve(testDir, '.mcpifyrc.json');

  afterEach(async () => {
    try {
      await unlink(configPath);
    } catch {}
  });

  it('should load config from .mcpifyrc.json', async () => {
    await writeFile(configPath, JSON.stringify({
      spec: './api.yaml',
      transport: 'http',
      port: 8080,
      bearerToken: 'test-token',
    }));

    const config = await loadConfig(testDir);
    expect(config.spec).toBe('./api.yaml');
    expect(config.transport).toBe('http');
    expect(config.port).toBe(8080);
    expect(config.bearerToken).toBe('test-token');
  });

  it('should return empty config when no file exists', async () => {
    const config = await loadConfig(testDir);
    expect(config).toEqual({});
  });
});

describe('mergeConfig', () => {
  it('should use CLI opts over file config', () => {
    const fileConfig = {
      spec: './file.yaml',
      transport: 'http' as const,
      port: 8080,
    };
    const cliOpts = {
      spec: './cli.yaml',
      port: '9090',
    };

    const merged = mergeConfig(fileConfig, cliOpts);
    expect(merged.spec).toBe('./cli.yaml');
    expect(merged.port).toBe(9090);
    expect(merged.transport).toBe('http');
  });

  it('should fall back to file config when CLI opts are undefined', () => {
    const fileConfig = {
      bearerToken: 'file-token',
      include: ['get*'],
      tags: ['pets'],
    };

    const merged = mergeConfig(fileConfig, {});
    expect(merged.bearerToken).toBe('file-token');
    expect(merged.include).toEqual(['get*']);
    expect(merged.tags).toEqual(['pets']);
  });

  it('should use defaults when neither file nor CLI provides values', () => {
    const merged = mergeConfig({}, {});
    expect(merged.transport).toBe('stdio');
    expect(merged.port).toBe(3100);
    expect(merged.maxResponseSize).toBe(50);
  });

  it('should split comma-separated CLI strings into arrays', () => {
    const merged = mergeConfig({}, {
      include: 'get*,list*',
      exclude: 'delete*',
      tags: 'pets,users',
    });
    expect(merged.include).toEqual(['get*', 'list*']);
    expect(merged.exclude).toEqual(['delete*']);
    expect(merged.tags).toEqual(['pets', 'users']);
  });
});
