import { describe, it, expect, afterEach } from 'vitest';
import { startServer } from '../src/runtime/server.js';
import type { ServerConfig } from '../src/types.js';
import type { Server } from '@modelcontextprotocol/sdk/server/index.js';

function makeConfig(port: number): ServerConfig {
  return {
    spec: {
      title: 'Test API',
      version: '1.0.0',
      defaultServerUrl: 'https://api.example.com',
      operations: [
        {
          operationId: 'healthCheck',
          method: 'GET',
          path: '/health',
          tags: [],
          parameters: [],
          security: [],
          servers: [],
          summary: 'Health check',
        },
      ],
      securitySchemes: {},
    },
    tools: [
      {
        name: 'healthCheck',
        description: 'Health check',
        inputSchema: { type: 'object' },
        annotations: { readOnlyHint: true },
      },
    ],
    operations: [
      {
        operationId: 'healthCheck',
        method: 'GET',
        path: '/health',
        tags: [],
        parameters: [],
        security: [],
        servers: [],
        summary: 'Health check',
      },
    ],
    baseUrl: 'https://api.example.com',
    auth: { type: 'none' },
    transport: 'http',
    port,
    maxResponseSize: 50 * 1024,
  };
}

describe('HTTP Transport', () => {
  let server: Server | undefined;

  afterEach(async () => {
    if (server) {
      await server.close();
      server = undefined;
    }
  });

  it('should start HTTP server and respond to health check', async () => {
    const port = 23451;
    server = await startServer(makeConfig(port));

    const res = await fetch(`http://localhost:${port}/health`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe('ok');
  });

  it('should return 404 for unknown paths', async () => {
    const port = 23452;
    server = await startServer(makeConfig(port));

    const res = await fetch(`http://localhost:${port}/unknown`);
    expect(res.status).toBe(404);
  });

  it('should accept MCP initialize request on /mcp', async () => {
    const port = 23453;
    server = await startServer(makeConfig(port));

    const res = await fetch(`http://localhost:${port}/mcp`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json, text/event-stream',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        method: 'initialize',
        params: {
          protocolVersion: '2025-03-26',
          capabilities: {},
          clientInfo: { name: 'test', version: '1.0.0' },
        },
        id: 1,
      }),
    });

    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toContain('serverInfo');
  });
});
