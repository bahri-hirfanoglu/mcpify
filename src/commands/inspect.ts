import { minimatch } from 'minimatch';
import { parseSpec } from '../parser/openapi.js';
import { generateTools } from '../generator/tools.js';
import { joinBaseUrl } from '../runtime/http-client.js';
import { sanitizeKey } from '../sanitize.js';
import type {
  McpToolDefinition,
  ParsedOperation,
  FilterOptions,
} from '../types.js';

export interface InspectResult {
  tool: McpToolDefinition;
  operation: ParsedOperation;
  example: Record<string, unknown>;
  curl: string;
  baseUrl: string;
}

export interface InspectOptions {
  filter?: FilterOptions;
  baseUrl?: string;
}

export async function runInspect(
  specSource: string,
  toolName: string,
  opts: InspectOptions = {},
): Promise<InspectResult> {
  const spec = await parseSpec(specSource);
  const tools = generateTools(spec.operations, opts.filter);

  const tool = tools.find((t) => t.name === toolName);
  if (!tool) {
    const suggestions = suggestToolNames(toolName, tools);
    const hint =
      suggestions.length > 0
        ? `\nDid you mean: ${suggestions.join(', ')}?`
        : `\nRun "mcpify <spec> --dry-run" to list tools.`;
    throw new Error(`Tool "${toolName}" not found${hint}`);
  }

  // Re-resolve the ParsedOperation this tool was generated from
  const operation = findOperationForTool(tool, spec.operations, opts.filter);
  if (!operation) {
    throw new Error(
      `Internal: could not map tool "${toolName}" back to an operation`,
    );
  }

  const baseUrl = opts.baseUrl ?? spec.defaultServerUrl;
  const example = buildExample(tool.inputSchema);
  const curl = buildCurl(operation, baseUrl, example);

  return { tool, operation, example, curl, baseUrl };
}

function findOperationForTool(
  tool: McpToolDefinition,
  operations: ParsedOperation[],
  filter?: FilterOptions,
): ParsedOperation | undefined {
  // The generator filters operations first, then maps 1:1 preserving order.
  // Replay the same filter and index by tool name.
  const generated = generateTools(operations, filter);
  const index = generated.findIndex((t) => t.name === tool.name);
  if (index === -1) return undefined;

  const filtered = replayFilter(operations, filter);
  return filtered[index];
}

function replayFilter(
  operations: ParsedOperation[],
  options?: FilterOptions,
): ParsedOperation[] {
  if (!options) return operations;
  let result = operations;
  if (options.tags && options.tags.length > 0) {
    result = result.filter((op) =>
      op.tags.some((t) => options.tags!.includes(t)),
    );
  }
  if (options.include && options.include.length > 0) {
    result = result.filter((op) =>
      options.include!.some((pattern) => minimatch(op.operationId, pattern)),
    );
  }
  if (options.exclude && options.exclude.length > 0) {
    result = result.filter(
      (op) =>
        !options.exclude!.some((pattern) => minimatch(op.operationId, pattern)),
    );
  }
  return result;
}

export function buildExample(
  schema: Record<string, unknown>,
): Record<string, unknown> {
  const example = generatePlaceholder(schema);
  if (example && typeof example === 'object' && !Array.isArray(example)) {
    return example as Record<string, unknown>;
  }
  return {};
}

function generatePlaceholder(schema: unknown): unknown {
  if (!schema || typeof schema !== 'object') return null;
  const s = schema as Record<string, unknown>;

  if (s.example !== undefined) return s.example;
  if (Array.isArray(s.enum) && s.enum.length > 0) return s.enum[0];
  if (s.default !== undefined) return s.default;

  const type = s.type as string | undefined;

  if (type === 'string') {
    const format = s.format as string | undefined;
    if (format === 'date-time') return '2024-01-01T00:00:00Z';
    if (format === 'date') return '2024-01-01';
    if (format === 'email') return 'user@example.com';
    if (format === 'uuid') return '00000000-0000-0000-0000-000000000000';
    if (format) return `<${format}>`;
    return '<string>';
  }
  if (type === 'integer') return 0;
  if (type === 'number') return 0;
  if (type === 'boolean') return false;
  if (type === 'null') return null;

  if (type === 'array') {
    const items = s.items;
    return [generatePlaceholder(items)];
  }

  if (type === 'object' || s.properties) {
    const props = (s.properties ?? {}) as Record<string, unknown>;
    const result: Record<string, unknown> = {};
    for (const [key, propSchema] of Object.entries(props)) {
      result[key] = generatePlaceholder(propSchema);
    }
    return result;
  }

  // Handle anyOf/oneOf by picking the first
  const union = (s.anyOf ?? s.oneOf) as unknown[] | undefined;
  if (Array.isArray(union) && union.length > 0) {
    return generatePlaceholder(union[0]);
  }

  return null;
}

export function buildCurl(
  operation: ParsedOperation,
  baseUrl: string,
  example: Record<string, unknown>,
): string {
  let path = operation.path;
  for (const param of operation.parameters.filter((p) => p.in === 'path')) {
    const argKey = sanitizeKey(param.name);
    const value = example[argKey] ?? `<${param.name}>`;
    path = path.replace(
      `{${param.name}}`,
      encodeURIComponent(String(value)),
    );
  }

  const url = joinBaseUrl(baseUrl, path);
  for (const param of operation.parameters.filter((p) => p.in === 'query')) {
    const argKey = sanitizeKey(param.name);
    if (example[argKey] != null) {
      url.searchParams.set(param.name, String(example[argKey]));
    }
  }

  const parts: string[] = [`curl -X ${operation.method} '${url.toString()}'`];
  parts.push(`  -H 'Accept: application/json'`);

  for (const param of operation.parameters.filter((p) => p.in === 'header')) {
    parts.push(`  -H '${param.name}: <${param.name}>'`);
  }

  if (operation.requestBody) {
    parts.push(`  -H 'Content-Type: ${operation.requestBody.contentType}'`);
    const bodyExample = example._body ?? generatePlaceholder(operation.requestBody.schema);
    parts.push(`  -d '${JSON.stringify(bodyExample)}'`);
  }

  return parts.join(' \\\n');
}

function suggestToolNames(
  target: string,
  tools: McpToolDefinition[],
): string[] {
  const lower = target.toLowerCase();
  return tools
    .map((t) => t.name)
    .filter((n) => n.toLowerCase().includes(lower) || lower.includes(n.toLowerCase()))
    .slice(0, 5);
}

export function formatInspectResult(result: InspectResult): string {
  const { tool, operation, example, curl, baseUrl } = result;
  const lines: string[] = [];

  lines.push('');
  lines.push(tool.name);
  lines.push('─'.repeat(tool.name.length));
  lines.push(`${operation.method} ${operation.path}`);
  lines.push(`Base URL: ${baseUrl}`);

  if (operation.tags.length > 0) {
    lines.push(`Tags: ${operation.tags.join(', ')}`);
  }

  const hints: string[] = [];
  if (tool.annotations?.readOnlyHint) hints.push('read-only');
  if (tool.annotations?.destructiveHint) hints.push('destructive');
  if (hints.length > 0) lines.push(`Hints: ${hints.join(', ')}`);

  lines.push('');
  lines.push('Description:');
  lines.push(indent(tool.description, 2));

  lines.push('');
  lines.push('Input schema:');
  lines.push(indent(JSON.stringify(tool.inputSchema, null, 2), 2));

  lines.push('');
  lines.push('Example arguments:');
  lines.push(indent(JSON.stringify(example, null, 2), 2));

  lines.push('');
  lines.push('cURL:');
  lines.push(indent(curl, 2));
  lines.push('');

  return lines.join('\n');
}

function indent(text: string, spaces: number): string {
  const pad = ' '.repeat(spaces);
  return text
    .split('\n')
    .map((line) => pad + line)
    .join('\n');
}
