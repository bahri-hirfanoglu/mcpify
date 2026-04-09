import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

export interface McpifyConfig {
  spec?: string;
  transport?: 'stdio' | 'http';
  port?: number;
  baseUrl?: string;
  bearerToken?: string;
  apiKeyHeader?: string;
  apiKeyValue?: string;
  include?: string[];
  exclude?: string[];
  tags?: string[];
  maxResponseSize?: number;
  naming?: 'camelCase' | 'snake_case' | 'original';
  prefix?: string;
  headers?: Record<string, string>;
  verbose?: boolean;
}

const CONFIG_FILES = ['.mcpifyrc.json', '.mcpifyrc', 'mcpify.config.json'];

export async function loadConfig(cwd: string = process.cwd()): Promise<McpifyConfig> {
  for (const name of CONFIG_FILES) {
    try {
      const path = resolve(cwd, name);
      const content = await readFile(path, 'utf-8');
      const config = JSON.parse(content) as McpifyConfig;
      process.stderr.write(`Loaded config from ${name}\n`);
      return config;
    } catch {
      // File doesn't exist or isn't valid JSON, try next
    }
  }
  return {};
}

export function mergeConfig(
  fileConfig: McpifyConfig,
  cliOpts: Record<string, string | undefined>,
): McpifyConfig {
  return {
    spec: cliOpts.spec ?? fileConfig.spec,
    transport: (cliOpts.transport as 'stdio' | 'http') ?? fileConfig.transport ?? 'stdio',
    port: cliOpts.port ? parseInt(cliOpts.port, 10) : fileConfig.port ?? 3100,
    baseUrl: cliOpts.baseUrl ?? fileConfig.baseUrl,
    bearerToken: cliOpts.bearerToken ?? fileConfig.bearerToken,
    apiKeyHeader: cliOpts.apiKeyHeader ?? fileConfig.apiKeyHeader,
    apiKeyValue: cliOpts.apiKeyValue ?? fileConfig.apiKeyValue,
    include: cliOpts.include
      ? cliOpts.include.split(',')
      : fileConfig.include,
    exclude: cliOpts.exclude
      ? cliOpts.exclude.split(',')
      : fileConfig.exclude,
    tags: cliOpts.tags ? cliOpts.tags.split(',') : fileConfig.tags,
    maxResponseSize: cliOpts.maxResponseSize
      ? parseInt(cliOpts.maxResponseSize, 10)
      : fileConfig.maxResponseSize ?? 50,
    headers: parseHeaders(cliOpts.header) ?? fileConfig.headers,
    verbose: cliOpts.verbose !== undefined ? true : fileConfig.verbose,
  };
}

function parseHeaders(raw: string | string[] | undefined): Record<string, string> | undefined {
  if (!raw) return undefined;
  const values = Array.isArray(raw) ? raw : [raw];
  const headers: Record<string, string> = {};
  for (const entry of values) {
    const idx = entry.indexOf(':');
    if (idx === -1) {
      process.stderr.write(`Warning: ignoring malformed header "${entry}" (expected "Key: Value")\n`);
      continue;
    }
    headers[entry.slice(0, idx).trim()] = entry.slice(idx + 1).trim();
  }
  return Object.keys(headers).length > 0 ? headers : undefined;
}
