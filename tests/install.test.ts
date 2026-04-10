import { describe, it, expect, afterEach } from 'vitest';
import { mkdtemp, rm, readFile, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import {
  runInstall,
  resolveClaudeConfigPath,
  deriveNameFromSpec,
} from '../src/commands/install.js';

describe('resolveClaudeConfigPath', () => {
  it('returns AppData path on win32', () => {
    const p = resolveClaudeConfigPath('win32', 'C:\\Users\\test', {
      APPDATA: 'C:\\Users\\test\\AppData\\Roaming',
    });
    expect(p).toContain('Claude');
    expect(p).toContain('claude_desktop_config.json');
    expect(p).toContain('AppData');
  });

  it('returns Library path on darwin', () => {
    const p = resolveClaudeConfigPath('darwin', '/Users/test', {});
    expect(p).toBe(
      '/Users/test/Library/Application Support/Claude/claude_desktop_config.json',
    );
  });

  it('returns .config path on linux', () => {
    const p = resolveClaudeConfigPath('linux', '/home/test', {});
    expect(p).toBe(
      '/home/test/.config/Claude/claude_desktop_config.json',
    );
  });

  it('respects XDG_CONFIG_HOME on linux', () => {
    const p = resolveClaudeConfigPath('linux', '/home/test', {
      XDG_CONFIG_HOME: '/home/test/.xdg',
    });
    expect(p).toBe('/home/test/.xdg/Claude/claude_desktop_config.json');
  });
});

describe('deriveNameFromSpec', () => {
  it('derives name from file basename', () => {
    expect(deriveNameFromSpec('./api.yaml')).toBe('api');
    expect(deriveNameFromSpec('/path/to/petstore.json')).toBe('petstore');
    expect(deriveNameFromSpec('my-api.yml')).toBe('my-api');
  });

  it('derives name from URL hostname', () => {
    expect(deriveNameFromSpec('https://petstore.swagger.io/v2/swagger.json'))
      .toBe('petstore');
    expect(deriveNameFromSpec('http://api.example.com/spec'))
      .toBe('api');
  });

  it('sanitizes disallowed characters and trims trailing dashes', () => {
    expect(deriveNameFromSpec('./weird name!.yaml')).toBe('weird-name');
  });
});

describe('runInstall', () => {
  let tmpDir: string;

  afterEach(async () => {
    if (tmpDir) await rm(tmpDir, { recursive: true, force: true });
  });

  it('creates config file if none exists', async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'mcpify-install-'));
    const configPath = resolve(tmpDir, 'nested', 'config.json');

    const result = await runInstall({
      spec: './api.yaml',
      name: 'my-api',
      configPath,
    });

    expect(result.action).toBe('added');
    const content = await readFile(configPath, 'utf-8');
    const config = JSON.parse(content);
    expect(config.mcpServers['my-api']).toEqual({
      command: 'mcpify',
      args: ['./api.yaml'],
    });
  });

  it('preserves existing servers and other keys', async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'mcpify-install-'));
    const configPath = resolve(tmpDir, 'config.json');
    await writeFile(
      configPath,
      JSON.stringify({
        globalShortcut: 'Alt+Space',
        mcpServers: {
          existing: { command: 'other', args: [] },
        },
      }),
    );

    await runInstall({
      spec: './api.yaml',
      name: 'petstore',
      configPath,
    });

    const config = JSON.parse(await readFile(configPath, 'utf-8'));
    expect(config.globalShortcut).toBe('Alt+Space');
    expect(config.mcpServers.existing).toBeDefined();
    expect(config.mcpServers.petstore).toBeDefined();
  });

  it('refuses to overwrite existing entry without force', async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'mcpify-install-'));
    const configPath = resolve(tmpDir, 'config.json');
    await writeFile(
      configPath,
      JSON.stringify({
        mcpServers: {
          petstore: { command: 'old', args: [] },
        },
      }),
    );

    await expect(
      runInstall({
        spec: './api.yaml',
        name: 'petstore',
        configPath,
      }),
    ).rejects.toThrow(/already exists/);

    // Ensure we didn't clobber
    const config = JSON.parse(await readFile(configPath, 'utf-8'));
    expect(config.mcpServers.petstore.command).toBe('old');
  });

  it('overwrites with --force and reports "updated"', async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'mcpify-install-'));
    const configPath = resolve(tmpDir, 'config.json');
    await writeFile(
      configPath,
      JSON.stringify({
        mcpServers: {
          petstore: { command: 'old', args: [] },
        },
      }),
    );

    const result = await runInstall({
      spec: './api.yaml',
      name: 'petstore',
      configPath,
      force: true,
    });

    expect(result.action).toBe('updated');
    const config = JSON.parse(await readFile(configPath, 'utf-8'));
    expect(config.mcpServers.petstore.command).toBe('mcpify');
    expect(config.mcpServers.petstore.args).toEqual(['./api.yaml']);
  });

  it('includes extra args and env', async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'mcpify-install-'));
    const configPath = resolve(tmpDir, 'config.json');

    await runInstall({
      spec: './api.yaml',
      name: 'my-api',
      configPath,
      extraArgs: ['--transport', 'http', '--port', '3100'],
      env: { MCPIFY_BEARER_TOKEN: 'sk-test' },
    });

    const config = JSON.parse(await readFile(configPath, 'utf-8'));
    expect(config.mcpServers['my-api'].args).toEqual([
      './api.yaml',
      '--transport',
      'http',
      '--port',
      '3100',
    ]);
    expect(config.mcpServers['my-api'].env).toEqual({
      MCPIFY_BEARER_TOKEN: 'sk-test',
    });
  });

  it('derives name from spec when name not provided', async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'mcpify-install-'));
    const configPath = resolve(tmpDir, 'config.json');

    const result = await runInstall({
      spec: './petstore.yaml',
      configPath,
    });

    expect(result.serverName).toBe('petstore');
    const config = JSON.parse(await readFile(configPath, 'utf-8'));
    expect(config.mcpServers.petstore).toBeDefined();
  });

  it('rejects invalid JSON in existing config', async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'mcpify-install-'));
    const configPath = resolve(tmpDir, 'config.json');
    await writeFile(configPath, '{bad json');

    await expect(
      runInstall({
        spec: './api.yaml',
        name: 'x',
        configPath,
      }),
    ).rejects.toThrow(/not valid JSON/);
  });

  it('handles empty config file', async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'mcpify-install-'));
    const configPath = resolve(tmpDir, 'config.json');
    await writeFile(configPath, '');

    const result = await runInstall({
      spec: './api.yaml',
      name: 'x',
      configPath,
    });
    expect(result.action).toBe('added');
  });

  it('uses custom command override', async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'mcpify-install-'));
    const configPath = resolve(tmpDir, 'config.json');

    await runInstall({
      spec: './api.yaml',
      name: 'x',
      configPath,
      command: 'npx',
      extraArgs: ['-y', '@bahridev/mcpify@latest'],
    });

    const config = JSON.parse(await readFile(configPath, 'utf-8'));
    expect(config.mcpServers.x.command).toBe('npx');
    expect(config.mcpServers.x.args[0]).toBe('./api.yaml');
  });
});
