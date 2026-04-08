import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import type { ServerConfig, ParsedOperation } from '../types.js';
import { executeRequest } from './http-client.js';

export async function startServer(config: ServerConfig): Promise<Server> {
  const server = new Server(
    {
      name: `mcpify — ${config.spec.title}`,
      version: config.spec.version,
    },
    {
      capabilities: {
        tools: {},
      },
    },
  );

  const operationMap = new Map<string, ParsedOperation>();
  for (const op of config.operations) {
    operationMap.set(op.operationId, op);
  }

  server.setRequestHandler(ListToolsRequestSchema, async () => {
    return {
      tools: config.tools.map((t) => ({
        name: t.name,
        description: t.description,
        inputSchema: t.inputSchema as Record<string, unknown> & { type: 'object' },
        annotations: t.annotations,
      })),
    };
  });

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

    const result = await executeRequest(
      operation,
      args,
      config.baseUrl,
      config.auth,
      config.maxResponseSize,
    );

    return result as typeof result & Record<string, unknown>;
  });

  if (config.transport === 'stdio') {
    const transport = new StdioServerTransport();
    await server.connect(transport);
    process.stderr.write(
      `mcpify v1.0.0 — serving ${config.tools.length} tools from "${config.spec.title}"\n`,
    );
  }

  const shutdown = async () => {
    await server.close();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  return server;
}
