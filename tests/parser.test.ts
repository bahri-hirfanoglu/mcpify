import { describe, it, expect } from 'vitest';
import { parseSpec } from '../src/parser/openapi.js';
import path from 'node:path';

const fixture = (name: string) =>
  path.resolve(import.meta.dirname, 'fixtures', name);

describe('parseSpec', () => {
  it('should parse petstore spec', async () => {
    const spec = await parseSpec(fixture('petstore.yaml'));

    expect(spec.title).toBe('Petstore API');
    expect(spec.version).toBe('1.0.0');
    expect(spec.description).toBe('A sample pet store API');
    expect(spec.defaultServerUrl).toBe('https://petstore.example.com/v1');
    expect(spec.operations).toHaveLength(4);
    expect(spec.securitySchemes).toHaveProperty('bearerAuth');
    expect(spec.securitySchemes.bearerAuth.type).toBe('http');
    expect(spec.securitySchemes.bearerAuth.scheme).toBe('bearer');
  });

  it('should extract operations correctly', async () => {
    const spec = await parseSpec(fixture('petstore.yaml'));
    const ops = spec.operations;

    const listPets = ops.find((o) => o.operationId === 'listPets')!;
    expect(listPets.method).toBe('GET');
    expect(listPets.path).toBe('/pets');
    expect(listPets.tags).toEqual(['pets']);
    expect(listPets.parameters).toHaveLength(1);
    expect(listPets.parameters[0].name).toBe('limit');
    expect(listPets.parameters[0].in).toBe('query');

    const createPet = ops.find((o) => o.operationId === 'createPet')!;
    expect(createPet.method).toBe('POST');
    expect(createPet.requestBody).toBeDefined();
    expect(createPet.requestBody!.required).toBe(true);
    expect(createPet.requestBody!.contentType).toBe('application/json');

    const deletePet = ops.find((o) => o.operationId === 'deletePet')!;
    expect(deletePet.method).toBe('DELETE');
    expect(deletePet.parameters[0].name).toBe('petId');
    expect(deletePet.parameters[0].in).toBe('path');
    expect(deletePet.parameters[0].required).toBe(true);
  });

  it('should generate operationId when missing', async () => {
    const spec = await parseSpec(fixture('minimal.json'));
    expect(spec.operations).toHaveLength(1);
    expect(spec.operations[0].operationId).toBe('get_health');
  });

  it('should extract security from root level', async () => {
    const spec = await parseSpec(fixture('petstore.yaml'));
    const listPets = spec.operations.find(
      (o) => o.operationId === 'listPets',
    )!;
    expect(listPets.security).toHaveLength(1);
    expect(listPets.security[0].name).toBe('bearerAuth');
  });

  it('should use localhost when no servers defined', async () => {
    const spec = await parseSpec(fixture('minimal.json'));
    expect(spec.defaultServerUrl).toBe('http://localhost');
  });

  it('should extract oauth2 flows and openIdConnect URL', async () => {
    const spec = await parseSpec(fixture('oauth.yaml'));

    const oauth = spec.securitySchemes.oauth;
    expect(oauth.type).toBe('oauth2');
    expect(oauth.flows).toBeDefined();
    expect(oauth.flows!.clientCredentials?.tokenUrl).toBe(
      'https://auth.example.com/token',
    );
    expect(oauth.flows!.clientCredentials?.scopes).toEqual({
      read: 'Read access',
      write: 'Write access',
    });
    expect(oauth.flows!.authorizationCode?.authorizationUrl).toBe(
      'https://auth.example.com/authorize',
    );
    expect(oauth.flows!.authorizationCode?.refreshUrl).toBe(
      'https://auth.example.com/token',
    );

    const oidc = spec.securitySchemes.oidc;
    expect(oidc.type).toBe('openIdConnect');
    expect(oidc.openIdConnectUrl).toBe(
      'https://auth.example.com/.well-known/openid-configuration',
    );
  });
});
