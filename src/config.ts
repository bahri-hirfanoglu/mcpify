import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

export interface OAuthConfig {
  flow?: 'client_credentials' | 'refresh_token';
  tokenUrl?: string;
  clientId?: string;
  clientSecret?: string;
  refreshToken?: string;
  scopes?: string[];
}

export interface McpifyConfig {
  spec?: string;
  transport?: 'stdio' | 'http';
  port?: number;
  baseUrl?: string;
  bearerToken?: string;
  apiKeyHeader?: string;
  apiKeyValue?: string;
  oauth?: OAuthConfig;
  include?: string[];
  exclude?: string[];
  tags?: string[];
  maxResponseSize?: number;
  naming?: 'camelCase' | 'snake_case' | 'original';
  prefix?: string;
  headers?: Record<string, string>;
  verbose?: boolean;
  retry?: number;
  retryDelay?: number;
  retryMaxDelay?: number;
  cacheTtl?: number;
  cacheMax?: number;
  autoPaginate?: boolean;
  maxPages?: number;
  responseFields?: string[];
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
    oauth: mergeOAuth(fileConfig.oauth, cliOpts),
    headers: parseHeaders(cliOpts.header) ?? fileConfig.headers,
    verbose: cliOpts.verbose !== undefined ? true : fileConfig.verbose,
    retry: cliOpts.retry !== undefined ? parseInt(cliOpts.retry, 10) : fileConfig.retry,
    retryDelay: cliOpts.retryDelay !== undefined ? parseInt(cliOpts.retryDelay, 10) : fileConfig.retryDelay,
    retryMaxDelay: cliOpts.retryMaxDelay !== undefined ? parseInt(cliOpts.retryMaxDelay, 10) : fileConfig.retryMaxDelay,
    cacheTtl: cliOpts.cacheTtl !== undefined ? parseInt(cliOpts.cacheTtl, 10) : fileConfig.cacheTtl,
    cacheMax: cliOpts.cacheMax !== undefined ? parseInt(cliOpts.cacheMax, 10) : fileConfig.cacheMax,
    autoPaginate: cliOpts.autoPaginate !== undefined ? true : fileConfig.autoPaginate,
    maxPages: cliOpts.maxPages !== undefined ? parseInt(cliOpts.maxPages, 10) : fileConfig.maxPages,
    responseFields: cliOpts.responseFields
      ? cliOpts.responseFields.split(',').map((s) => s.trim()).filter(Boolean)
      : fileConfig.responseFields,
  };
}

function mergeOAuth(
  fileOAuth: OAuthConfig | undefined,
  cliOpts: Record<string, string | undefined>,
): OAuthConfig | undefined {
  const scopesRaw = cliOpts.oauthScopes;
  const merged: OAuthConfig = {
    flow: (cliOpts.oauthFlow as OAuthConfig['flow']) ?? fileOAuth?.flow,
    tokenUrl: cliOpts.oauthTokenUrl ?? fileOAuth?.tokenUrl,
    clientId: cliOpts.oauthClientId ?? fileOAuth?.clientId,
    clientSecret: cliOpts.oauthClientSecret ?? fileOAuth?.clientSecret,
    refreshToken: cliOpts.oauthRefreshToken ?? fileOAuth?.refreshToken,
    scopes: scopesRaw ? scopesRaw.split(',').map((s) => s.trim()) : fileOAuth?.scopes,
  };

  // Strip undefined keys; return undefined if everything was empty
  const hasAny = Object.values(merged).some((v) => v !== undefined);
  return hasAny ? merged : undefined;
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
