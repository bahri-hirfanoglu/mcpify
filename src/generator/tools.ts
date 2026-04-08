import { minimatch } from 'minimatch';
import type {
  ParsedOperation,
  McpToolDefinition,
  FilterOptions,
} from '../types.js';

export function generateTools(
  operations: ParsedOperation[],
  options?: FilterOptions,
): McpToolDefinition[] {
  const filtered = filterOperations(operations, options);

  if (filtered.length === 0) {
    process.stderr.write(
      'Warning: no operations matched after filtering\n',
    );
  }

  return filtered.map((op) => {
    const tool = operationToTool(op);
    tool.name = transformName(tool.name, options?.naming, options?.prefix);
    return tool;
  });
}

function filterOperations(
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
      options.include!.some((pattern) =>
        minimatch(op.operationId, pattern),
      ),
    );
  }

  if (options.exclude && options.exclude.length > 0) {
    result = result.filter(
      (op) =>
        !options.exclude!.some((pattern) =>
          minimatch(op.operationId, pattern),
        ),
    );
  }

  return result;
}

function operationToTool(op: ParsedOperation): McpToolDefinition {
  const properties: Record<string, unknown> = {};
  const required: string[] = [];

  for (const param of op.parameters) {
    if (param.in === 'header') continue;

    const prop: Record<string, unknown> = { ...param.schema };
    if (param.description) prop.description = param.description;
    properties[param.name] = prop;

    if (param.required) required.push(param.name);
  }

  const headerParams = op.parameters.filter((p) => p.in === 'header');
  if (headerParams.length > 0) {
    const headerProps: Record<string, unknown> = {};
    const headerRequired: string[] = [];
    for (const h of headerParams) {
      const prop: Record<string, unknown> = { ...h.schema };
      if (h.description) prop.description = h.description;
      headerProps[h.name] = prop;
      if (h.required) headerRequired.push(h.name);
    }
    properties._headers = {
      type: 'object',
      properties: headerProps,
      ...(headerRequired.length > 0 ? { required: headerRequired } : {}),
    };
  }

  if (op.requestBody) {
    const bodyProp: Record<string, unknown> = { ...op.requestBody.schema };
    properties._body = bodyProp;
    if (op.requestBody.required) required.push('_body');
  }

  const inputSchema: Record<string, unknown> = {
    type: 'object',
    properties,
    ...(required.length > 0 ? { required } : {}),
  };

  if (Object.keys(properties).length === 0) {
    delete inputSchema.properties;
  }

  const description = buildDescription(op);
  const annotations = buildAnnotations(op.method);

  return {
    name: op.operationId,
    description,
    inputSchema,
    ...(annotations ? { annotations } : {}),
  };
}

function buildDescription(op: ParsedOperation): string {
  const parts: string[] = [];
  if (op.summary) parts.push(op.summary);
  if (op.description && op.description !== op.summary) {
    parts.push(op.description);
  }
  if (parts.length === 0) {
    parts.push(`${op.method} ${op.path}`);
  }

  if (op.responseSchema) {
    const hint = summarizeSchema(op.responseSchema);
    if (hint) parts.push(`Returns: ${hint}`);
  }

  const text = parts.join('\n\n');
  return text.length > 1024 ? text.slice(0, 1021) + '...' : text;
}

function summarizeSchema(schema: Record<string, unknown>): string {
  const type = schema.type as string | undefined;

  if (type === 'array') {
    const items = schema.items as Record<string, unknown> | undefined;
    if (items) {
      const itemType = summarizeObjectSchema(items);
      return `array of ${itemType}`;
    }
    return 'array';
  }

  if (type === 'object') {
    return summarizeObjectSchema(schema);
  }

  if (type) return type;
  return 'object';
}

function summarizeObjectSchema(schema: Record<string, unknown>): string {
  const props = schema.properties as
    | Record<string, Record<string, unknown>>
    | undefined;
  if (!props) return 'object';

  const keys = Object.keys(props);
  if (keys.length === 0) return 'object';
  if (keys.length <= 5) return `{${keys.join(', ')}}`;
  return `{${keys.slice(0, 5).join(', ')}, ...${keys.length - 5} more}`;
}

function buildAnnotations(
  method: string,
): McpToolDefinition['annotations'] | undefined {
  switch (method) {
    case 'GET':
    case 'HEAD':
    case 'OPTIONS':
      return { readOnlyHint: true };
    case 'DELETE':
      return { destructiveHint: true };
    default:
      return undefined;
  }
}

function transformName(
  name: string,
  naming?: 'camelCase' | 'snake_case' | 'original',
  prefix?: string,
): string {
  let result = name;

  if (naming === 'snake_case') {
    result = toSnakeCase(result);
  } else if (naming === 'camelCase') {
    result = toCamelCase(result);
  }

  if (prefix) {
    result = prefix + result;
  }

  return result;
}

function toSnakeCase(str: string): string {
  return str
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/([A-Z])([A-Z][a-z])/g, '$1_$2')
    .replace(/[-\s]+/g, '_')
    .toLowerCase();
}

function toCamelCase(str: string): string {
  return str
    .replace(/[-_\s]+(.)?/g, (_, c: string | undefined) =>
      c ? c.toUpperCase() : '',
    )
    .replace(/^[A-Z]/, (c) => c.toLowerCase());
}
