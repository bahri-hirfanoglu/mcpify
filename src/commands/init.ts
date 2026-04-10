import { writeFile, access } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createInterface } from 'node:readline/promises';
import type { McpifyConfig, OAuthConfig } from '../config.js';

export interface Prompter {
  ask(question: string, defaultValue?: string): Promise<string>;
  confirm(question: string, defaultValue?: boolean): Promise<boolean>;
  close(): void;
}

export interface InitOptions {
  cwd?: string;
  force?: boolean;
}

export interface InitResult {
  path: string;
  config: McpifyConfig;
}

const CONFIG_FILENAME = '.mcpifyrc.json';

export function createReadlinePrompter(): Prompter {
  const rl = createInterface({
    input: process.stdin,
    output: process.stderr,
  });

  return {
    async ask(question: string, defaultValue?: string): Promise<string> {
      const suffix = defaultValue ? ` (${defaultValue})` : '';
      const answer = (await rl.question(`${question}${suffix}: `)).trim();
      return answer || defaultValue || '';
    },
    async confirm(question: string, defaultValue = false): Promise<boolean> {
      const suffix = defaultValue ? 'Y/n' : 'y/N';
      const answer = (await rl.question(`${question} (${suffix}): `))
        .trim()
        .toLowerCase();
      if (!answer) return defaultValue;
      return answer === 'y' || answer === 'yes';
    },
    close(): void {
      rl.close();
    },
  };
}

export async function runInit(
  prompter: Prompter,
  opts: InitOptions = {},
): Promise<InitResult> {
  const cwd = opts.cwd ?? process.cwd();
  const path = resolve(cwd, CONFIG_FILENAME);

  if (!opts.force) {
    let exists = false;
    try {
      await access(path);
      exists = true;
    } catch {
      // file doesn't exist — fine
    }
    if (exists) {
      const overwrite = await prompter.confirm(
        `${CONFIG_FILENAME} already exists. Overwrite?`,
        false,
      );
      if (!overwrite) {
        throw new Error('Aborted: config file already exists');
      }
    }
  }

  const config = await collectConfig(prompter);
  await writeFile(path, JSON.stringify(config, null, 2) + '\n', 'utf-8');

  return { path, config };
}

export async function collectConfig(prompter: Prompter): Promise<McpifyConfig> {
  const config: McpifyConfig = {};

  const spec = await prompter.ask(
    'OpenAPI spec source (file path or URL)',
  );
  if (!spec) throw new Error('spec is required');
  config.spec = spec;

  const transport = await prompter.ask(
    'Transport (stdio | http)',
    'stdio',
  );
  if (transport !== 'stdio' && transport !== 'http') {
    throw new Error(`Invalid transport: ${transport}`);
  }
  config.transport = transport;

  if (transport === 'http') {
    const port = await prompter.ask('HTTP port', '3100');
    const portNum = parseInt(port, 10);
    if (Number.isNaN(portNum)) throw new Error(`Invalid port: ${port}`);
    config.port = portNum;
  }

  const baseUrl = await prompter.ask('Override base URL (empty to skip)', '');
  if (baseUrl) config.baseUrl = baseUrl;

  const authType = await prompter.ask(
    'Auth type (none | bearer | api-key | oauth2)',
    'none',
  );

  if (authType === 'bearer') {
    const token = await prompter.ask('Bearer token (empty = set via env)', '');
    if (token) config.bearerToken = token;
  } else if (authType === 'api-key') {
    const header = await prompter.ask('API key header name', 'X-API-Key');
    const value = await prompter.ask('API key value (empty = set via env)', '');
    config.apiKeyHeader = header;
    if (value) config.apiKeyValue = value;
  } else if (authType === 'oauth2') {
    config.oauth = await collectOAuth(prompter);
  } else if (authType !== 'none') {
    throw new Error(`Invalid auth type: ${authType}`);
  }

  const include = await prompter.ask(
    'Include operations (comma-separated globs, empty = all)',
    '',
  );
  if (include) config.include = include.split(',').map((s) => s.trim());

  const exclude = await prompter.ask(
    'Exclude operations (comma-separated globs, empty = none)',
    '',
  );
  if (exclude) config.exclude = exclude.split(',').map((s) => s.trim());

  const tags = await prompter.ask(
    'Filter by tags (comma-separated, empty = all)',
    '',
  );
  if (tags) config.tags = tags.split(',').map((s) => s.trim());

  const naming = await prompter.ask(
    'Tool naming (original | camelCase | snake_case)',
    'original',
  );
  if (
    naming !== 'original' &&
    naming !== 'camelCase' &&
    naming !== 'snake_case'
  ) {
    throw new Error(`Invalid naming: ${naming}`);
  }
  if (naming !== 'original') config.naming = naming;

  const prefix = await prompter.ask('Tool name prefix (empty = none)', '');
  if (prefix) config.prefix = prefix;

  const verbose = await prompter.confirm('Enable verbose logging?', false);
  if (verbose) config.verbose = true;

  return config;
}

async function collectOAuth(prompter: Prompter): Promise<OAuthConfig> {
  const flow = await prompter.ask(
    'OAuth2 flow (client_credentials | refresh_token)',
    'client_credentials',
  );
  if (flow !== 'client_credentials' && flow !== 'refresh_token') {
    throw new Error(`Invalid OAuth2 flow: ${flow}`);
  }

  const oauth: OAuthConfig = { flow };

  const tokenUrl = await prompter.ask(
    'OAuth2 token URL (empty to auto-detect from spec)',
    '',
  );
  if (tokenUrl) oauth.tokenUrl = tokenUrl;

  const clientId = await prompter.ask(
    'OAuth2 client ID (empty = set via env)',
    '',
  );
  if (clientId) oauth.clientId = clientId;

  const clientSecret = await prompter.ask(
    'OAuth2 client secret (empty = set via env)',
    '',
  );
  if (clientSecret) oauth.clientSecret = clientSecret;

  if (flow === 'refresh_token') {
    const refreshToken = await prompter.ask(
      'OAuth2 refresh token (empty = set via env)',
      '',
    );
    if (refreshToken) oauth.refreshToken = refreshToken;
  }

  const scopes = await prompter.ask(
    'OAuth2 scopes (comma-separated, empty = none)',
    '',
  );
  if (scopes) oauth.scopes = scopes.split(',').map((s) => s.trim());

  return oauth;
}
