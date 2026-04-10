import { describe, it, expect } from 'vitest';
import path from 'node:path';
import {
  runInspect,
  buildExample,
  buildCurl,
  formatInspectResult,
} from '../src/commands/inspect.js';
import type { ParsedOperation } from '../src/types.js';

const fixture = (name: string) =>
  path.resolve(import.meta.dirname, 'fixtures', name);

describe('runInspect', () => {
  it('resolves and inspects a tool by original name', async () => {
    const result = await runInspect(fixture('petstore.yaml'), 'getPet');
    expect(result.tool.name).toBe('getPet');
    expect(result.operation.method).toBe('GET');
    expect(result.operation.path).toBe('/pets/{petId}');
    expect(result.example).toHaveProperty('petId');
    expect(result.baseUrl).toBe('https://petstore.example.com/v1');
  });

  it('resolves renamed tool with prefix + snake_case', async () => {
    const result = await runInspect(fixture('petstore.yaml'), 'api_list_pets', {
      filter: { prefix: 'api_', naming: 'snake_case' },
    });
    expect(result.operation.operationId).toBe('listPets');
  });

  it('throws with suggestions when tool not found', async () => {
    try {
      await runInspect(fixture('petstore.yaml'), 'getPett');
      expect.fail('should have thrown');
    } catch (err) {
      expect((err as Error).message).toContain('not found');
      expect((err as Error).message).toContain('getPet');
    }
  });

  it('includes body in example for POST operations', async () => {
    const result = await runInspect(fixture('petstore.yaml'), 'createPet');
    expect(result.example).toHaveProperty('_body');
    const body = result.example._body as Record<string, unknown>;
    expect(body).toHaveProperty('name');
  });

  it('generates cURL with path parameter substitution', async () => {
    const result = await runInspect(fixture('petstore.yaml'), 'getPet');
    expect(result.curl).toContain('curl -X GET');
    expect(result.curl).toContain('https://petstore.example.com/v1/pets/');
    // Placeholder substituted
    expect(result.curl).not.toContain('{petId}');
  });

  it('respects --base-url override', async () => {
    const result = await runInspect(fixture('petstore.yaml'), 'getPet', {
      baseUrl: 'https://staging.example.com',
    });
    expect(result.curl).toContain('https://staging.example.com/pets/');
  });
});

describe('buildExample', () => {
  it('handles primitive types', () => {
    const schema = {
      type: 'object',
      properties: {
        name: { type: 'string' },
        age: { type: 'integer' },
        active: { type: 'boolean' },
      },
    };
    const example = buildExample(schema);
    expect(example.name).toBe('<string>');
    expect(example.age).toBe(0);
    expect(example.active).toBe(false);
  });

  it('uses example field when present', () => {
    const schema = {
      type: 'object',
      properties: {
        status: { type: 'string', example: 'active' },
      },
    };
    const example = buildExample(schema);
    expect(example.status).toBe('active');
  });

  it('uses enum first value', () => {
    const schema = {
      type: 'object',
      properties: {
        color: { type: 'string', enum: ['red', 'green', 'blue'] },
      },
    };
    const example = buildExample(schema);
    expect(example.color).toBe('red');
  });

  it('generates format-specific placeholders', () => {
    const schema = {
      type: 'object',
      properties: {
        email: { type: 'string', format: 'email' },
        id: { type: 'string', format: 'uuid' },
        created: { type: 'string', format: 'date-time' },
      },
    };
    const example = buildExample(schema);
    expect(example.email).toBe('user@example.com');
    expect(example.id).toBe('00000000-0000-0000-0000-000000000000');
    expect(example.created).toContain('2024-');
  });

  it('handles nested objects and arrays', () => {
    const schema = {
      type: 'object',
      properties: {
        pets: {
          type: 'array',
          items: {
            type: 'object',
            properties: { name: { type: 'string' } },
          },
        },
      },
    };
    const example = buildExample(schema);
    expect(Array.isArray(example.pets)).toBe(true);
    expect((example.pets as unknown[])[0]).toEqual({ name: '<string>' });
  });
});

describe('buildCurl', () => {
  const op: ParsedOperation = {
    operationId: 'getPet',
    method: 'GET',
    path: '/pets/{petId}',
    tags: [],
    parameters: [
      { name: 'petId', in: 'path', required: true, schema: { type: 'string' } },
      { name: 'expand', in: 'query', required: false, schema: { type: 'string' } },
    ],
    security: [],
    servers: [],
  };

  it('substitutes path parameter and adds query', () => {
    const curl = buildCurl(op, 'https://api.example.com', {
      petId: 'rex',
      expand: 'owner',
    });
    expect(curl).toContain("'https://api.example.com/pets/rex?expand=owner'");
  });

  it('adds Content-Type and body for POST', () => {
    const postOp: ParsedOperation = {
      ...op,
      method: 'POST',
      path: '/pets',
      requestBody: {
        required: true,
        contentType: 'application/json',
        schema: { type: 'object', properties: { name: { type: 'string' } } },
      },
    };
    const curl = buildCurl(postOp, 'https://api.example.com', {
      _body: { name: 'Rex' },
    });
    expect(curl).toContain('curl -X POST');
    expect(curl).toContain("-H 'Content-Type: application/json'");
    expect(curl).toContain('-d \'{"name":"Rex"}\'');
  });
});

describe('formatInspectResult', () => {
  it('produces human-readable output with all sections', async () => {
    const result = await runInspect(fixture('petstore.yaml'), 'getPet');
    const output = formatInspectResult(result);

    expect(output).toContain('getPet');
    expect(output).toContain('GET /pets/{petId}');
    expect(output).toContain('Description:');
    expect(output).toContain('Input schema:');
    expect(output).toContain('Example arguments:');
    expect(output).toContain('cURL:');
  });
});
