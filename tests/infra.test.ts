import { describe, it, expect } from 'vitest';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');

async function readRepoFile(relative: string): Promise<string> {
  return readFile(resolve(root, relative), 'utf-8');
}

describe('Dockerfile', () => {
  it('uses node alpine image and multi-stage build', async () => {
    const content = await readRepoFile('Dockerfile');
    expect(content).toMatch(/FROM node:\d+-alpine AS build/);
    expect(content).toMatch(/FROM node:\d+-alpine AS runtime/);
  });

  it('installs deps via npm ci and builds with tsc', async () => {
    const content = await readRepoFile('Dockerfile');
    expect(content).toContain('npm ci');
    expect(content).toContain('npm run build');
  });

  it('exposes port 3100 and sets cli.js as entrypoint', async () => {
    const content = await readRepoFile('Dockerfile');
    expect(content).toContain('EXPOSE 3100');
    expect(content).toContain('ENTRYPOINT ["node", "/app/dist/cli.js"]');
  });
});

describe('.dockerignore', () => {
  it('excludes node_modules, dist, tests, and VCS metadata', async () => {
    const content = await readRepoFile('.dockerignore');
    const lines = content.split('\n').map((l) => l.trim());
    expect(lines).toContain('node_modules');
    expect(lines).toContain('dist');
    expect(lines).toContain('tests');
    expect(lines).toContain('.git');
  });
});

describe('action.yml', () => {
  it('declares spec as required input', async () => {
    const content = await readRepoFile('action.yml');
    expect(content).toContain('name: mcpify');
    expect(content).toMatch(/spec:\s*\n\s*description:/);
    expect(content).toMatch(/required: true/);
  });

  it('uses composite runs', async () => {
    const content = await readRepoFile('action.yml');
    expect(content).toContain('using: composite');
  });

  it('installs from npm and supports validate / dry-run / inspect / serve commands', async () => {
    const content = await readRepoFile('action.yml');
    expect(content).toContain('@bahridev/mcpify');
    expect(content).toContain('mcpify validate');
    expect(content).toContain('--dry-run');
    expect(content).toContain('mcpify inspect');
    expect(content).toContain('--transport');
  });
});

describe('CI workflow', () => {
  it('runs on push and pull_request', async () => {
    const content = await readRepoFile('.github/workflows/ci.yml');
    expect(content).toContain('on:');
    expect(content).toContain('push:');
    expect(content).toContain('pull_request:');
  });

  it('tests across multiple node versions', async () => {
    const content = await readRepoFile('.github/workflows/ci.yml');
    expect(content).toContain('matrix:');
    expect(content).toContain('npm test');
    expect(content).toContain('npm ci');
  });

  it('builds the Docker image', async () => {
    const content = await readRepoFile('.github/workflows/ci.yml');
    expect(content).toContain('docker/build-push-action');
  });
});

describe('Release workflow', () => {
  it('triggers on version tags', async () => {
    const content = await readRepoFile('.github/workflows/release.yml');
    expect(content).toMatch(/tags:\s*\n\s*-\s*'v\*\.\*\.\*'/);
  });

  it('publishes to npm and ghcr', async () => {
    const content = await readRepoFile('.github/workflows/release.yml');
    expect(content).toContain('npm publish');
    expect(content).toContain('ghcr.io');
    expect(content).toContain('NPM_TOKEN');
  });
});
