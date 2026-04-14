import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
  isInitializeRequest,
} from '@modelcontextprotocol/sdk/types.js';
import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import type { ServerConfig } from '../types.js';
import { executeRequest } from './http-client.js';
import { ResponseCache } from './cache.js';

function createMcpServer(config: ServerConfig): Server {
  const cache = config.cache && config.cache.ttlMs > 0
    ? new ResponseCache({ ttlMs: config.cache.ttlMs, maxEntries: config.cache.maxEntries })
    : undefined;

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

    const operation = config.operations.find((op) => op.operationId === toolName);
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
      {
        maxResponseSize: config.maxResponseSize,
        verbose: config.verbose,
        customHeaders: config.customHeaders,
        retry: config.retry,
        cache,
        pagination: config.pagination,
        responseFields: config.responseFields,
      },
    );

    return result as typeof result & Record<string, unknown>;
  });

  return server;
}

export async function startServer(config: ServerConfig): Promise<Server> {
  let server: Server;

  if (config.transport === 'stdio') {
    server = createMcpServer(config);
    const transport = new StdioServerTransport();
    await server.connect(transport);
  } else {
    server = createMcpServer(config);
    await startHttpTransport(() => createMcpServer(config), config.port);
  }

  process.stderr.write(
    `mcpify v1.3.0 — serving ${config.tools.length} tools from "${config.spec.title}"` +
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
  serverFactory: () => Server,
  port: number,
): Promise<void> {
  const transports = new Map<string, StreamableHTTPServerTransport>();

  const httpServer = createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', `http://localhost:${port}`);

    if (url.pathname === '/mcp') {
      try {
        if (req.method === 'POST') {
          const chunks: Buffer[] = [];
          for await (const chunk of req) {
            chunks.push(chunk as Buffer);
          }
          const body = JSON.parse(Buffer.concat(chunks).toString());

          const sessionId = req.headers['mcp-session-id'] as string | undefined;

          if (sessionId && transports.has(sessionId)) {
            await transports.get(sessionId)!.handleRequest(req, res, body);
          } else if (!sessionId && isInitializeRequest(body)) {
            const transport = new StreamableHTTPServerTransport({
              sessionIdGenerator: () => randomUUID(),
              onsessioninitialized: (sid) => {
                transports.set(sid, transport);
              },
            });

            transport.onclose = () => {
              const sid = transport.sessionId;
              if (sid) transports.delete(sid);
            };

            const server = serverFactory();
            await server.connect(transport);
            await transport.handleRequest(req, res, body);
          } else {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
              jsonrpc: '2.0',
              error: { code: -32000, message: 'Bad Request: No valid session ID provided' },
              id: null,
            }));
          }
        } else if (req.method === 'GET') {
          const sessionId = req.headers['mcp-session-id'] as string | undefined;
          if (sessionId && transports.has(sessionId)) {
            await transports.get(sessionId)!.handleRequest(req, res);
          } else {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
              jsonrpc: '2.0',
              error: { code: -32000, message: 'Invalid or missing session ID' },
              id: null,
            }));
          }
        } else if (req.method === 'DELETE') {
          const sessionId = req.headers['mcp-session-id'] as string | undefined;
          if (sessionId && transports.has(sessionId)) {
            const transport = transports.get(sessionId)!;
            await transport.handleRequest(req, res);
            await transport.close();
            transports.delete(sessionId);
          } else {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
              jsonrpc: '2.0',
              error: { code: -32000, message: 'Invalid or missing session ID' },
              id: null,
            }));
          }
        } else {
          res.writeHead(405, { Allow: 'GET, POST, DELETE' });
          res.end('Method Not Allowed');
        }
      } catch (err) {
        process.stderr.write(`MCP request error: ${err}\n`);
        if (!res.headersSent) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            jsonrpc: '2.0',
            error: { code: -32603, message: 'Internal server error' },
            id: null,
          }));
        }
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
