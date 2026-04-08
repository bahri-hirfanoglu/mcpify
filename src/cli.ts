#!/usr/bin/env node

import { Command } from 'commander';
import { parseSpec } from './parser/openapi.js';
import { generateTools } from './generator/tools.js';
import { resolveAuth } from './auth/handler.js';
import { startServer } from './runtime/server.js';
import { loadConfig, mergeConfig } from './config.js';
import type { FilterOptions } from './types.js';

const program = new Command();

program
  .name('mcpify')
  .description('Generate an MCP server from an OpenAPI spec')
  .version('1.0.0')
  .argument('[spec]', 'OpenAPI spec file path or URL')
  .option('--spec <source>', 'OpenAPI spec file path or URL (alternative to positional argument)')
  .option('--transport <type>', 'transport type (stdio|http)')
  .option('--port <number>', 'HTTP port')
  .option('--base-url <url>', 'API base URL override')
  .option('--bearer-token <token>', 'Bearer token for authentication')
  .option('--api-key-header <name>', 'API key header name')
  .option('--api-key-value <value>', 'API key value')
  .option('--include <patterns>', 'include operations matching glob patterns (comma-separated)')
  .option('--exclude <patterns>', 'exclude operations matching glob patterns (comma-separated)')
  .option('--tags <tags>', 'only include operations with these tags (comma-separated)')
  .option('--max-response-size <kb>', 'max response size in KB')
  .option('--verbose', 'verbose logging to stderr')
  .action(async (specArg: string | undefined, opts: Record<string, string>) => {
    try {
      const fileConfig = await loadConfig();
      const config = mergeConfig(fileConfig, opts);

      const specSource = config.spec ?? specArg;

      if (!specSource || typeof specSource !== 'string') {
        process.stderr.write('Error: spec source is required. Usage: mcpify <spec> or mcpify --spec <source>\n');
        process.exit(1);
      }

      if (config.verbose) {
        process.stderr.write(`Parsing spec: ${specSource}\n`);
      }

      const spec = await parseSpec(specSource);

      const filterOptions: FilterOptions = {};
      if (config.include) filterOptions.include = config.include;
      if (config.exclude) filterOptions.exclude = config.exclude;
      if (config.tags) filterOptions.tags = config.tags;

      const tools = generateTools(spec.operations, filterOptions);

      if (tools.length === 0) {
        process.stderr.write('Error: no tools generated from spec\n');
        process.exit(1);
      }

      const auth = resolveAuth(
        {
          bearerToken: config.bearerToken,
          apiKeyHeader: config.apiKeyHeader,
          apiKeyValue: config.apiKeyValue,
        },
        spec,
      );

      const baseUrl = config.baseUrl ?? spec.defaultServerUrl;

      await startServer({
        spec,
        tools,
        operations: spec.operations,
        baseUrl,
        auth,
        transport: config.transport!,
        port: config.port!,
        maxResponseSize: config.maxResponseSize! * 1024,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      process.stderr.write(`Error: ${message}\n`);
      process.exit(1);
    }
  });

program.parse();
