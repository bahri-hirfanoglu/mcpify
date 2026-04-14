import { describe, it, expect } from 'vitest';
import { resolve } from 'node:path';
import { runDiff, diffSpecs, hasBreakingChanges, formatDiff } from '../src/commands/diff.js';
import type { ParsedSpec } from '../src/types.js';

const V1 = resolve(__dirname, 'fixtures/minimal-v1.json');
const V2 = resolve(__dirname, 'fixtures/minimal-v2.json');

describe('runDiff', () => {
  it('reports added, removed, changed, unchanged', async () => {
    const result = await runDiff(V1, V2);

    const addedIds = result.operations.added.map((o) => o.operationId).sort();
    const removedIds = result.operations.removed.map((o) => o.operationId).sort();
    const changedIds = result.operations.changed.map((c) => c.operationId).sort();

    expect(addedIds).toEqual(['getStatus']);
    expect(removedIds).toEqual(['legacy']);
    expect(changedIds).toEqual(['getItem']);
    expect(result.operations.unchanged).toBe(1);
  });

  it('reports spec titles and versions', async () => {
    const result = await runDiff(V1, V2);
    expect(result.left.version).toBe('0.1.0');
    expect(result.right.version).toBe('0.2.0');
  });

  it('formats a readable diff', async () => {
    const result = await runDiff(V1, V2);
    const text = formatDiff(result);
    expect(text).toContain('Added:     1');
    expect(text).toContain('Removed:   1');
    expect(text).toContain('Changed:   1');
    expect(text).toContain('+ getStatus');
    expect(text).toContain('- legacy');
    expect(text).toContain('~ getItem');
  });
});

describe('hasBreakingChanges', () => {
  it('flags removed operations as breaking', async () => {
    const result = await runDiff(V1, V2);
    expect(hasBreakingChanges(result)).toBe(true);
  });

  it('does not flag purely additive changes', () => {
    const a: ParsedSpec = {
      title: 'A', version: '1', defaultServerUrl: 'http://x',
      operations: [{ operationId: 'a', method: 'GET', path: '/a', tags: [], parameters: [], security: [], servers: [] }],
      securitySchemes: {},
    };
    const b: ParsedSpec = {
      title: 'A', version: '2', defaultServerUrl: 'http://x',
      operations: [
        { operationId: 'a', method: 'GET', path: '/a', tags: [], parameters: [], security: [], servers: [] },
        { operationId: 'b', method: 'GET', path: '/b', tags: [], parameters: [], security: [], servers: [] },
      ],
      securitySchemes: {},
    };
    const result = diffSpecs(a, b);
    expect(hasBreakingChanges(result)).toBe(false);
    expect(result.operations.added).toHaveLength(1);
  });

  it('flags newly-required parameter as breaking', () => {
    const a: ParsedSpec = {
      title: 'A', version: '1', defaultServerUrl: 'http://x',
      operations: [{
        operationId: 'a', method: 'GET', path: '/a', tags: [],
        parameters: [{ name: 'q', in: 'query', required: false, schema: { type: 'string' } }],
        security: [], servers: [],
      }],
      securitySchemes: {},
    };
    const b: ParsedSpec = {
      title: 'A', version: '2', defaultServerUrl: 'http://x',
      operations: [{
        operationId: 'a', method: 'GET', path: '/a', tags: [],
        parameters: [{ name: 'q', in: 'query', required: true, schema: { type: 'string' } }],
        security: [], servers: [],
      }],
      securitySchemes: {},
    };
    const result = diffSpecs(a, b);
    expect(hasBreakingChanges(result)).toBe(true);
  });
});
