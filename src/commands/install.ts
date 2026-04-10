import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, basename, extname, posix, win32 } from 'node:path';

export interface InstallOptions {
  spec: string;
  name?: string;
  configPath?: string;
  force?: boolean;
  command?: string;
  extraArgs?: string[];
  env?: Record<string, string>;
}

export interface InstallResult {
  configPath: string;
  serverName: string;
  action: 'added' | 'updated';
  entry: McpServerEntry;
}

interface McpServerEntry {
  command: string;
  args?: string[];
  env?: Record<string, string>;
}

interface ClaudeDesktopConfig {
  mcpServers?: Record<string, McpServerEntry>;
  [key: string]: unknown;
}

export async function runInstall(
  opts: InstallOptions,
): Promise<InstallResult> {
  const configPath = opts.configPath ?? resolveClaudeConfigPath();
  const serverName = opts.name ?? deriveNameFromSpec(opts.spec);

  if (!serverName) {
    throw new Error(
      'Could not derive server name from spec source. Use --name to specify one.',
    );
  }

  const config = await readOrInit(configPath);
  config.mcpServers ??= {};

  const exists = !!config.mcpServers[serverName];
  if (exists && !opts.force) {
    throw new Error(
      `MCP server "${serverName}" already exists in ${configPath}. Use --force to overwrite.`,
    );
  }

  const entry: McpServerEntry = {
    command: opts.command ?? 'mcpify',
    args: [opts.spec, ...(opts.extraArgs ?? [])],
  };

  if (opts.env && Object.keys(opts.env).length > 0) {
    entry.env = opts.env;
  }

  config.mcpServers[serverName] = entry;

  await mkdir(dirname(configPath), { recursive: true });
  await writeFile(
    configPath,
    JSON.stringify(config, null, 2) + '\n',
    'utf-8',
  );

  return {
    configPath,
    serverName,
    action: exists ? 'updated' : 'added',
    entry,
  };
}

async function readOrInit(
  configPath: string,
): Promise<ClaudeDesktopConfig> {
  try {
    const content = await readFile(configPath, 'utf-8');
    if (!content.trim()) return {};
    const parsed = JSON.parse(content) as unknown;
    if (typeof parsed !== 'object' || parsed === null) {
      throw new Error(
        `${configPath} does not contain a JSON object`,
      );
    }
    return parsed as ClaudeDesktopConfig;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return {};
    }
    if (err instanceof SyntaxError) {
      throw new Error(
        `${configPath} is not valid JSON: ${err.message}`,
      );
    }
    throw err;
  }
}

export function resolveClaudeConfigPath(
  platform: NodeJS.Platform = process.platform,
  home: string = homedir(),
  env: NodeJS.ProcessEnv = process.env,
): string {
  // Use platform-specific path joining so the result is correct regardless
  // of the host OS (important for tests and for users generating configs
  // from a different platform than they'll run Claude Desktop on).
  if (platform === 'win32') {
    const appData = env.APPDATA ?? win32.join(home, 'AppData', 'Roaming');
    return win32.join(appData, 'Claude', 'claude_desktop_config.json');
  }
  if (platform === 'darwin') {
    return posix.join(
      home,
      'Library',
      'Application Support',
      'Claude',
      'claude_desktop_config.json',
    );
  }
  const xdgConfig = env.XDG_CONFIG_HOME ?? posix.join(home, '.config');
  return posix.join(xdgConfig, 'Claude', 'claude_desktop_config.json');
}

export function deriveNameFromSpec(spec: string): string | undefined {
  // For URLs: use hostname first label
  if (spec.startsWith('http://') || spec.startsWith('https://')) {
    try {
      const url = new URL(spec);
      const host = url.hostname;
      const firstLabel = host.split('.')[0];
      return sanitizeName(firstLabel);
    } catch {
      return undefined;
    }
  }
  const base = basename(spec, extname(spec));
  return sanitizeName(base);
}

function sanitizeName(name: string): string | undefined {
  const cleaned = name
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return cleaned || undefined;
}
