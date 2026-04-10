#!/usr/bin/env node

import { Command } from 'commander';
import { watch } from 'node:fs';
import { parseSpec } from './parser/openapi.js';
import { generateTools } from './generator/tools.js';
import { resolveAuth } from './auth/handler.js';
import { startServer } from './runtime/server.js';
import { loadConfig, mergeConfig } from './config.js';
import { runInit, createReadlinePrompter } from './commands/init.js';
import { runValidate, formatReport } from './commands/validate.js';
import type { FilterOptions, McpToolDefinition, ParsedSpec, ServerConfig } from './types.js';

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
  .option('--oauth-flow <flow>', 'OAuth2 flow (client_credentials | refresh_token)')
  .option('--oauth-token-url <url>', 'OAuth2 token endpoint URL')
  .option('--oauth-client-id <id>', 'OAuth2 client ID')
  .option('--oauth-client-secret <secret>', 'OAuth2 client secret')
  .option('--oauth-refresh-token <token>', 'OAuth2 refresh token')
  .option('--oauth-scopes <scopes>', 'OAuth2 scopes (comma-separated)')
  .option('--include <patterns>', 'include operations matching glob patterns (comma-separated)')
  .option('--exclude <patterns>', 'exclude operations matching glob patterns (comma-separated)')
  .option('--tags <tags>', 'only include operations with these tags (comma-separated)')
  .option('--max-response-size <kb>', 'max response size in KB')
  .option('--naming <style>', 'tool naming style (camelCase|snake_case|original)')
  .option('--prefix <prefix>', 'prefix to add to all tool names')
  .option('--header <key:value...>', 'custom headers (repeatable, e.g. --header "Authorization: Bearer token")')
  .option('--verbose', 'verbose logging to stderr')
  .option('--dry-run', 'parse spec and list tools without starting server')
  .option('--watch', 'watch spec file for changes and reload tools')
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
      if (opts.naming) filterOptions.naming = opts.naming as FilterOptions['naming'];
      if (opts.prefix) filterOptions.prefix = opts.prefix;

      const tools = generateTools(spec.operations, filterOptions);

      if (tools.length === 0) {
        process.stderr.write('Error: no tools generated from spec\n');
        process.exit(1);
      }

      if (opts.dryRun) {
        printToolsSummary(tools, spec);
        return;
      }

      const auth = resolveAuth(
        {
          bearerToken: config.bearerToken,
          apiKeyHeader: config.apiKeyHeader,
          apiKeyValue: config.apiKeyValue,
          oauth: config.oauth,
        },
        spec,
      );

      const baseUrl = config.baseUrl ?? spec.defaultServerUrl;

      const serverConfig: ServerConfig = {
        spec,
        tools,
        operations: spec.operations,
        baseUrl,
        auth,
        transport: config.transport!,
        port: config.port!,
        maxResponseSize: config.maxResponseSize! * 1024,
        customHeaders: config.headers,
        verbose: config.verbose,
      };

      await startServer(serverConfig);

      if (opts.watch && !specSource.startsWith('http')) {
        watchSpec(specSource, serverConfig, filterOptions);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      process.stderr.write(`Error: ${message}\n`);
      process.exit(1);
    }
  });

program
  .command('validate')
  .description('Validate an OpenAPI spec for mcpify compatibility')
  .argument('<spec>', 'OpenAPI spec file path or URL')
  .action(async (specArg: string) => {
    try {
      const report = await runValidate(specArg);
      process.stderr.write(formatReport(report));
      process.exit(report.errorCount > 0 ? 1 : 0);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      process.stderr.write(`\nError: ${message}\n`);
      process.exit(1);
    }
  });

program
  .command('init')
  .description('Interactively create a .mcpifyrc.json config file')
  .option('-f, --force', 'overwrite existing config without prompting')
  .action(async (opts: { force?: boolean }) => {
    const prompter = createReadlinePrompter();
    try {
      const result = await runInit(prompter, { force: opts.force });
      process.stderr.write(`\n✓ Wrote ${result.path}\n`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      process.stderr.write(`\nError: ${message}\n`);
      process.exit(1);
    } finally {
      prompter.close();
    }
  });

program.parse();

function watchSpec(
  specPath: string,
  serverConfig: ServerConfig,
  filterOptions: FilterOptions,
): void {
  let debounce: ReturnType<typeof setTimeout> | undefined;

  process.stderr.write(`Watching ${specPath} for changes...\n`);

  watch(specPath, () => {
    if (debounce) clearTimeout(debounce);
    debounce = setTimeout(async () => {
      try {
        process.stderr.write('Spec changed, reloading...\n');
        const spec = await parseSpec(specPath);
        const tools = generateTools(spec.operations, filterOptions);

        serverConfig.spec = spec;
        serverConfig.tools = tools;
        serverConfig.operations = spec.operations;

        process.stderr.write(
          `Reloaded: ${tools.length} tools from "${spec.title}"\n`,
        );
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        process.stderr.write(`Reload failed: ${msg}\n`);
      }
    }, 300);
  });
}

function printToolsSummary(tools: McpToolDefinition[], spec: ParsedSpec): void {
  process.stderr.write(`\n${spec.title} v${spec.version}\n`);
  process.stderr.write(`Base URL: ${spec.defaultServerUrl}\n`);
  process.stderr.write(`Tools: ${tools.length}\n\n`);

  const nameWidth = Math.max(4, ...tools.map((t) => t.name.length));

  process.stderr.write(
    `${'NAME'.padEnd(nameWidth)}  ${'DESCRIPTION'}\n`,
  );
  process.stderr.write(`${'─'.repeat(nameWidth)}  ${'─'.repeat(50)}\n`);

  for (const tool of tools) {
    const firstLine = tool.description.split('\n')[0];
    const desc = firstLine.length > 60
      ? firstLine.slice(0, 57) + '...'
      : firstLine;
    const hints: string[] = [];
    if (tool.annotations?.readOnlyHint) hints.push('read-only');
    if (tool.annotations?.destructiveHint) hints.push('destructive');
    const suffix = hints.length > 0 ? ` [${hints.join(', ')}]` : '';
    process.stderr.write(`${tool.name.padEnd(nameWidth)}  ${desc}${suffix}\n`);
  }

  process.stderr.write('\n');
}
