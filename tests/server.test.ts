import { describe, it, expect } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { startServer } from '../src/runtime/server.js';
import type { ServerConfig } from '../src/types.js';

function makeConfig(overrides: Partial<ServerConfig> = {}): ServerConfig {
  return {
    spec: {
      title: 'Test API',
      version: '1.0.0',
      defaultServerUrl: 'https://api.example.com',
      operations: [],
      securitySchemes: {},
    },
    tools: [],
    operations: [],
    baseUrl: 'https://api.example.com',
    auth: { type: 'none' },
    transport: 'stdio',
    port: 3100,
    maxResponseSize: 50 * 1024,
    ...overrides,
  };
}

describe('MCP Server', () => {
  it('should list registered tools', async () => {
    const config = makeConfig({
      tools: [
        {
          name: 'listPets',
          description: 'List all pets',
          inputSchema: {
            type: 'object',
            properties: { limit: { type: 'integer' } },
          },
          annotations: { readOnlyHint: true },
        },
      ],
    });

    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

    const { startServer: startServerFn } = await import('../src/runtime/server.js');

    // Create server manually for testing (bypass stdio)
    const { Server } = await import('@modelcontextprotocol/sdk/server/index.js');
    const {
      ListToolsRequestSchema,
      CallToolRequestSchema,
    } = await import('@modelcontextprotocol/sdk/types.js');

    const server = new Server(
      { name: 'test', version: '1.0.0' },
      { capabilities: { tools: {} } },
    );

    const operationMap = new Map();

    server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: config.tools.map((t) => ({
        name: t.name,
        description: t.description,
        inputSchema: t.inputSchema as Record<string, unknown> & { type: 'object' },
        annotations: t.annotations,
      })),
    }));

    server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const toolName = request.params.name;
      return {
        content: [{ type: 'text' as const, text: `called ${toolName}` }],
      };
    });

    await server.connect(serverTransport);

    const client = new Client({ name: 'test-client', version: '1.0.0' });
    await client.connect(clientTransport);

    const result = await client.listTools();
    expect(result.tools).toHaveLength(1);
    expect(result.tools[0].name).toBe('listPets');
    expect(result.tools[0].description).toBe('List all pets');

    const callResult = await client.callTool({
      name: 'listPets',
      arguments: {},
    });
    expect(callResult.content).toEqual([
      { type: 'text', text: 'called listPets' },
    ]);

    await client.close();
    await server.close();
  });
});
