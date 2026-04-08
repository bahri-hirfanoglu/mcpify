import { describe, it, expect } from 'vitest';
import { parseSpec } from '../src/parser/openapi.js';
import path from 'node:path';

const fixture = (name: string) =>
  path.resolve(import.meta.dirname, 'fixtures', name);

describe('Swagger 2.0 parsing', () => {
  it('should parse a Swagger 2.0 spec', async () => {
    const spec = await parseSpec(fixture('swagger2.json'));

    expect(spec.title).toBe('Swagger 2.0 Petstore');
    expect(spec.version).toBe('1.0.0');
    expect(spec.description).toBe('A sample Swagger 2.0 API');
    expect(spec.defaultServerUrl).toBe('https://petstore.example.com/v1');
  });

  it('should extract operations from Swagger 2.0', async () => {
    const spec = await parseSpec(fixture('swagger2.json'));

    expect(spec.operations).toHaveLength(3);
    const listPets = spec.operations.find((o) => o.operationId === 'listPets')!;
    expect(listPets.method).toBe('GET');
    expect(listPets.parameters).toHaveLength(1);
    expect(listPets.parameters[0].name).toBe('limit');
    expect(listPets.parameters[0].schema).toEqual({
      type: 'integer',
      maximum: 100,
    });
  });

  it('should extract body parameter as requestBody', async () => {
    const spec = await parseSpec(fixture('swagger2.json'));

    const createPet = spec.operations.find((o) => o.operationId === 'createPet')!;
    expect(createPet.requestBody).toBeDefined();
    expect(createPet.requestBody!.required).toBe(true);
    expect(createPet.requestBody!.contentType).toBe('application/json');
    expect(createPet.requestBody!.schema).toHaveProperty('properties');
  });

  it('should extract securityDefinitions', async () => {
    const spec = await parseSpec(fixture('swagger2.json'));

    expect(spec.securitySchemes).toHaveProperty('apiKey');
    expect(spec.securitySchemes.apiKey.type).toBe('apiKey');
    expect(spec.securitySchemes.apiKey.name).toBe('X-API-Key');
    expect(spec.securitySchemes.apiKey.in).toBe('header');
  });

  it('should extract root-level security', async () => {
    const spec = await parseSpec(fixture('swagger2.json'));

    const listPets = spec.operations.find((o) => o.operationId === 'listPets')!;
    expect(listPets.security).toHaveLength(1);
    expect(listPets.security[0].name).toBe('apiKey');
  });

  it('should build base URL from host + basePath + schemes', async () => {
    const spec = await parseSpec(fixture('swagger2.json'));
    expect(spec.defaultServerUrl).toBe('https://petstore.example.com/v1');
  });
});
