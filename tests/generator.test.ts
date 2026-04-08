import { describe, it, expect } from 'vitest';
import { generateTools } from '../src/generator/tools.js';
import type { ParsedOperation } from '../src/types.js';

function makeOp(overrides: Partial<ParsedOperation> = {}): ParsedOperation {
  return {
    operationId: 'testOp',
    method: 'GET',
    path: '/test',
    tags: [],
    parameters: [],
    security: [],
    servers: [],
    ...overrides,
  };
}

describe('generateTools', () => {
  it('should generate a tool from a simple GET operation', () => {
    const ops = [makeOp({
      operationId: 'listPets',
      summary: 'List all pets',
      parameters: [
        { name: 'limit', in: 'query', required: false, schema: { type: 'integer' } },
      ],
    })];

    const tools = generateTools(ops);
    expect(tools).toHaveLength(1);
    expect(tools[0].name).toBe('listPets');
    expect(tools[0].description).toBe('List all pets');
    expect(tools[0].inputSchema).toEqual({
      type: 'object',
      properties: {
        limit: { type: 'integer' },
      },
    });
    expect(tools[0].annotations).toEqual({ readOnlyHint: true });
  });

  it('should generate a tool with path params and request body', () => {
    const ops = [makeOp({
      operationId: 'updatePet',
      method: 'PUT',
      path: '/pets/{petId}',
      summary: 'Update a pet',
      parameters: [
        { name: 'petId', in: 'path', required: true, schema: { type: 'string' } },
      ],
      requestBody: {
        required: true,
        contentType: 'application/json',
        schema: { type: 'object', properties: { name: { type: 'string' } } },
      },
    })];

    const tools = generateTools(ops);
    expect(tools[0].inputSchema).toEqual({
      type: 'object',
      properties: {
        petId: { type: 'string' },
        _body: { type: 'object', properties: { name: { type: 'string' } } },
      },
      required: ['petId', '_body'],
    });
    expect(tools[0].annotations).toBeUndefined();
  });

  it('should set destructiveHint for DELETE', () => {
    const tools = generateTools([makeOp({ method: 'DELETE' })]);
    expect(tools[0].annotations).toEqual({ destructiveHint: true });
  });

  it('should generate empty schema for operation with no params', () => {
    const tools = generateTools([makeOp()]);
    expect(tools[0].inputSchema).toEqual({ type: 'object' });
  });

  it('should filter by tags', () => {
    const ops = [
      makeOp({ operationId: 'a', tags: ['pets'] }),
      makeOp({ operationId: 'b', tags: ['users'] }),
    ];
    const tools = generateTools(ops, { tags: ['pets'] });
    expect(tools).toHaveLength(1);
    expect(tools[0].name).toBe('a');
  });

  it('should filter by include pattern', () => {
    const ops = [
      makeOp({ operationId: 'listPets' }),
      makeOp({ operationId: 'createPet' }),
      makeOp({ operationId: 'getUser' }),
    ];
    const tools = generateTools(ops, { include: ['*Pet*'] });
    expect(tools).toHaveLength(2);
  });

  it('should filter by exclude pattern', () => {
    const ops = [
      makeOp({ operationId: 'listPets' }),
      makeOp({ operationId: 'deletePet' }),
    ];
    const tools = generateTools(ops, { exclude: ['delete*'] });
    expect(tools).toHaveLength(1);
    expect(tools[0].name).toBe('listPets');
  });

  it('should place header params under _headers', () => {
    const ops = [makeOp({
      parameters: [
        { name: 'X-Custom', in: 'header', required: true, schema: { type: 'string' } },
      ],
    })];
    const tools = generateTools(ops);
    const schema = tools[0].inputSchema as Record<string, any>;
    expect(schema.properties._headers).toEqual({
      type: 'object',
      properties: { 'X-Custom': { type: 'string' } },
      required: ['X-Custom'],
    });
  });

  it('should convert tool names to snake_case', () => {
    const ops = [makeOp({ operationId: 'listAllPets' })];
    const tools = generateTools(ops, { naming: 'snake_case' });
    expect(tools[0].name).toBe('list_all_pets');
  });

  it('should convert tool names to camelCase', () => {
    const ops = [makeOp({ operationId: 'get_all_users' })];
    const tools = generateTools(ops, { naming: 'camelCase' });
    expect(tools[0].name).toBe('getAllUsers');
  });

  it('should add prefix to tool names', () => {
    const ops = [makeOp({ operationId: 'listPets' })];
    const tools = generateTools(ops, { prefix: 'myapi_' });
    expect(tools[0].name).toBe('myapi_listPets');
  });

  it('should apply both naming and prefix', () => {
    const ops = [makeOp({ operationId: 'listAllPets' })];
    const tools = generateTools(ops, { naming: 'snake_case', prefix: 'api_' });
    expect(tools[0].name).toBe('api_list_all_pets');
  });

  it('should truncate description at 1024 chars', () => {
    const long = 'A'.repeat(2000);
    const ops = [makeOp({ summary: long })];
    const tools = generateTools(ops);
    expect(tools[0].description.length).toBe(1024);
    expect(tools[0].description.endsWith('...')).toBe(true);
  });
});
