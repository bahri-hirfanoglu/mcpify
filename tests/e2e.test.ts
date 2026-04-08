import { describe, it, expect, afterEach } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { parseSpec } from '../src/parser/openapi.js';
import { generateTools } from '../src/generator/tools.js';
import { resolveAuth } from '../src/auth/handler.js';
import { executeRequest } from '../src/runtime/http-client.js';
import type { ParsedOperation } from '../src/types.js';
import path from 'node:path';

const fixture = (name: string) =>
  path.resolve(import.meta.dirname, 'fixtures', name);

async function setupServer(specPath: string) {
  const spec = await parseSpec(specPath);
  const tools = generateTools(spec.operations);
  const auth = resolveAuth({}, spec);
  const baseUrl = spec.defaultServerUrl;

  const operationMap = new Map<string, ParsedOperation>();
  for (const op of spec.operations) {
    operationMap.set(op.operationId, op);
  }

  const server = new Server(
    { name: `mcpify — ${spec.title}`, version: spec.version },
    { capabilities: { tools: {} } },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: tools.map((t) => ({
      name: t.name,
      description: t.description,
      inputSchema: t.inputSchema as Record<string, unknown> & { type: 'object' },
      annotations: t.annotations,
    })),
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const toolName = request.params.name;
    const args = (request.params.arguments ?? {}) as Record<string, unknown>;
    const operation = operationMap.get(toolName);
    if (!operation) {
      return {
        content: [{ type: 'text' as const, text: `Unknown tool: ${toolName}` }],
        isError: true,
      };
    }
    const result = await executeRequest(operation, args, baseUrl, auth);
    return result as typeof result & Record<string, unknown>;
  });

  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);

  const client = new Client({ name: 'test-client', version: '1.0.0' });
  await client.connect(clientTransport);

  return { server, client, spec, tools };
}

describe('E2E: full pipeline', () => {
  let server: Server | undefined;
  let client: Client | undefined;

  afterEach(async () => {
    await client?.close();
    await server?.close();
  });

  it('should parse petstore and list all 4 tools', async () => {
    const ctx = await setupServer(fixture('petstore.yaml'));
    server = ctx.server;
    client = ctx.client;

    const result = await client.listTools();
    expect(result.tools).toHaveLength(4);

    const names = result.tools.map((t) => t.name).sort();
    expect(names).toEqual(['createPet', 'deletePet', 'getPet', 'listPets']);

    const listPets = result.tools.find((t) => t.name === 'listPets')!;
    expect(listPets.description).toBe('List all pets');
    expect(listPets.inputSchema.properties).toHaveProperty('limit');
  });

  it('should parse complex spec with generated operationIds', async () => {
    const ctx = await setupServer(fixture('complex.yaml'));
    server = ctx.server;
    client = ctx.client;

    const result = await client.listTools();
    expect(result.tools).toHaveLength(7);

    const names = result.tools.map((t) => t.name);
    expect(names).toContain('get_users');
    expect(names).toContain('createUser');
    expect(names).toContain('getUser');
    expect(names).toContain('deleteUser');
    expect(names).toContain('listItems');
    expect(names).toContain('getItem');
    expect(names).toContain('updateItem');
  });

  it('should parse minimal spec with no auth and no servers', async () => {
    const ctx = await setupServer(fixture('minimal.json'));
    server = ctx.server;
    client = ctx.client;

    const result = await client.listTools();
    expect(result.tools).toHaveLength(1);
    expect(result.tools[0].name).toBe('get_health');

    expect(ctx.spec.defaultServerUrl).toBe('http://localhost');
    expect(Object.keys(ctx.spec.securitySchemes)).toHaveLength(0);
  });

  it('should return error for unknown tool call', async () => {
    const ctx = await setupServer(fixture('petstore.yaml'));
    server = ctx.server;
    client = ctx.client;

    const result = await client.callTool({
      name: 'nonExistent',
      arguments: {},
    });
    expect(result.isError).toBe(true);
    expect((result.content as Array<{ text: string }>)[0].text).toContain(
      'Unknown tool',
    );
  });

  it('should have correct annotations on tools', async () => {
    const ctx = await setupServer(fixture('petstore.yaml'));
    server = ctx.server;
    client = ctx.client;

    const result = await client.listTools();
    const listPets = result.tools.find((t) => t.name === 'listPets')!;
    expect(listPets.annotations?.readOnlyHint).toBe(true);

    const deletePet = result.tools.find((t) => t.name === 'deletePet')!;
    expect(deletePet.annotations?.destructiveHint).toBe(true);

    const createPet = result.tools.find((t) => t.name === 'createPet')!;
    expect(createPet.annotations).toBeUndefined();
  });

  it('should handle path-level parameters in complex spec', async () => {
    const ctx = await setupServer(fixture('complex.yaml'));
    server = ctx.server;
    client = ctx.client;

    const result = await client.listTools();
    const getItem = result.tools.find((t) => t.name === 'getItem')!;
    expect(getItem.inputSchema.properties).toHaveProperty('itemId');
    expect(
      (getItem.inputSchema as Record<string, unknown[]>).required,
    ).toContain('itemId');
  });
});
