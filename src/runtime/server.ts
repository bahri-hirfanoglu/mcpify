import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
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
  } else if (config.transport === 'http') {
    await startHttpTransport(server, config.port);
  }

  process.stderr.write(
    `mcpify v1.0.0 — serving ${config.tools.length} tools from "${config.spec.title}"` +
    (config.transport === 'http' ? ` on http://localhost:${config.port}/mcp` : '') +
    '\n',
  );

  const shutdown = async () => {
    await server.close();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  return server;
}

async function startHttpTransport(
  server: Server,
  port: number,
): Promise<void> {
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: () => randomUUID(),
  });

  await server.connect(transport);

  const httpServer = createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', `http://localhost:${port}`);

    if (url.pathname === '/mcp') {
      // Parse JSON body for POST requests
      if (req.method === 'POST') {
        const chunks: Buffer[] = [];
        for await (const chunk of req) {
          chunks.push(chunk as Buffer);
        }
        const body = JSON.parse(Buffer.concat(chunks).toString());
        await transport.handleRequest(req, res, body);
      } else {
        await transport.handleRequest(req, res);
      }
    } else if (url.pathname === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok' }));
    } else {
      res.writeHead(404);
      res.end('Not Found');
    }
  });

  await new Promise<void>((resolve) => {
    httpServer.listen(port, () => resolve());
  });
}
