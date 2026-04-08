#!/usr/bin/env node

import { Command } from 'commander';
import { parseSpec } from './parser/openapi.js';
import { generateTools } from './generator/tools.js';
import { resolveAuth } from './auth/handler.js';
import { startServer } from './runtime/server.js';
import type { FilterOptions } from './types.js';

const program = new Command();

program
  .name('mcpify')
  .description('Generate an MCP server from an OpenAPI spec')
  .version('1.0.0')
  .argument('<spec>', 'OpenAPI spec file path or URL')
  .option('--transport <type>', 'transport type (stdio|http)', 'stdio')
  .option('--port <number>', 'HTTP port', '3100')
  .option('--base-url <url>', 'API base URL override')
  .option('--bearer-token <token>', 'Bearer token for authentication')
  .option('--api-key-header <name>', 'API key header name')
  .option('--api-key-value <value>', 'API key value')
  .option('--include <patterns>', 'include operations matching glob patterns (comma-separated)')
  .option('--exclude <patterns>', 'exclude operations matching glob patterns (comma-separated)')
  .option('--tags <tags>', 'only include operations with these tags (comma-separated)')
  .option('--max-response-size <kb>', 'max response size in KB', '50')
  .option('--verbose', 'verbose logging to stderr')
  .action(async (specSource: string, opts: Record<string, string>) => {
    try {
      if (opts.verbose) {
        process.stderr.write(`Parsing spec: ${specSource}\n`);
      }

      const spec = await parseSpec(specSource);

      const filterOptions: FilterOptions = {};
      if (opts.include) filterOptions.include = opts.include.split(',');
      if (opts.exclude) filterOptions.exclude = opts.exclude.split(',');
      if (opts.tags) filterOptions.tags = opts.tags.split(',');

      const tools = generateTools(spec.operations, filterOptions);

      if (tools.length === 0) {
        process.stderr.write('Error: no tools generated from spec\n');
        process.exit(1);
      }

      const auth = resolveAuth(
        {
          bearerToken: opts.bearerToken,
          apiKeyHeader: opts.apiKeyHeader,
          apiKeyValue: opts.apiKeyValue,
        },
        spec,
      );

      const baseUrl = opts.baseUrl ?? spec.defaultServerUrl;
      const transport = opts.transport as 'stdio' | 'http';
      const port = parseInt(opts.port, 10);
      const maxResponseSize = parseInt(opts.maxResponseSize, 10) * 1024;

      await startServer({
        spec,
        tools,
        operations: spec.operations,
        baseUrl,
        auth,
        transport,
        port,
        maxResponseSize,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      process.stderr.write(`Error: ${message}\n`);
      process.exit(1);
    }
  });

program.parse();
