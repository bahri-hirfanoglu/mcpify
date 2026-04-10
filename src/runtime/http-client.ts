import type { ParsedOperation, AuthConfig } from '../types.js';
import { applyAuth } from '../auth/handler.js';
import { sanitizeKey, restoreKeys } from '../sanitize.js';

interface CallToolResult {
  content: Array<{ type: string; text: string }>;
  isError?: boolean;
}

export async function executeRequest(
  operation: ParsedOperation,
  args: Record<string, unknown>,
  baseUrl: string,
  auth: AuthConfig,
  maxResponseSize: number = 50 * 1024,
  verbose: boolean = false,
  customHeaders?: Record<string, string>,
): Promise<CallToolResult> {
  try {
    const url = buildUrl(operation, args, baseUrl);
    const headers = await buildHeaders(operation, args, auth, customHeaders);
    const body = buildBody(args, operation);

    if (verbose) {
      process.stderr.write(`→ ${operation.method} ${url}\n`);
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30_000);
    const start = Date.now();

    let response: Response;
    try {
      response = await fetch(url, {
        method: operation.method,
        headers,
        body,
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeout);
    }

    const duration = Date.now() - start;
    const result = await handleResponse(response, maxResponseSize);

    if (verbose) {
      const size = result.content[0]?.text.length ?? 0;
      const status = response.status;
      const icon = result.isError ? '✗' : '✓';
      process.stderr.write(
        `← ${icon} ${status} ${duration}ms ${formatSize(size)}\n`,
      );
    }

    return result;
  } catch (err) {
    const message =
      err instanceof Error ? err.message : 'Unknown error';
    if (verbose) {
      process.stderr.write(`← ✗ ERROR: ${message}\n`);
    }
    return {
      content: [{ type: 'text', text: `Request failed: ${message}` }],
      isError: true,
    };
  }
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

function buildUrl(
  operation: ParsedOperation,
  args: Record<string, unknown>,
  baseUrl: string,
): string {
  let path = operation.path;

  for (const param of operation.parameters) {
    const argKey = sanitizeKey(param.name);
    if (param.in === 'path' && args[argKey] != null) {
      path = path.replace(
        `{${param.name}}`,
        encodeURIComponent(String(args[argKey])),
      );
    }
  }

  const url = joinBaseUrl(baseUrl, path);

  for (const param of operation.parameters) {
    const argKey = sanitizeKey(param.name);
    if (param.in === 'query' && args[argKey] != null) {
      url.searchParams.set(param.name, String(args[argKey]));
    }
  }

  return url.toString();
}

export function joinBaseUrl(baseUrl: string, path: string): URL {
  // new URL('/foo', 'https://host/v1/') drops /v1. Strip leading slash so the
  // relative path joins below the base path instead of replacing it.
  const base = baseUrl.endsWith('/') ? baseUrl : baseUrl + '/';
  const relative = path.startsWith('/') ? path.slice(1) : path;
  return new URL(relative, base);
}

async function buildHeaders(
  operation: ParsedOperation,
  args: Record<string, unknown>,
  auth: AuthConfig,
  customHeaders?: Record<string, string>,
): Promise<Record<string, string>> {
  const headers: Record<string, string> = {
    Accept: 'application/json',
  };

  if (customHeaders) {
    Object.assign(headers, customHeaders);
  }

  if (operation.requestBody) {
    headers['Content-Type'] = operation.requestBody.contentType;
  }

  const operationHeaders = args._headers as
    | Record<string, unknown>
    | undefined;
  if (operationHeaders) {
    // Restore original header names from sanitized keys
    const headerParams = operation.parameters.filter((p) => p.in === 'header');
    const reverseMap = new Map<string, string>();
    for (const p of headerParams) {
      reverseMap.set(sanitizeKey(p.name), p.name);
    }
    for (const [key, value] of Object.entries(operationHeaders)) {
      const originalName = reverseMap.get(key) ?? key;
      if (value != null) headers[originalName] = String(value);
    }
  }

  await applyAuth(headers, auth);

  return headers;
}

function buildBody(
  args: Record<string, unknown>,
  operation: ParsedOperation,
): string | undefined {
  if (args._body == null) return undefined;
  const restored = restoreKeys(args._body, operation.requestBody?.schema);
  return JSON.stringify(restored);
}

async function handleResponse(
  response: Response,
  maxSize: number,
): Promise<CallToolResult> {
  const contentType = response.headers.get('content-type') ?? '';
  const isJson = contentType.includes('application/json');
  const isText =
    contentType.includes('text/') || contentType.includes('application/xml');

  if (!response.ok) {
    let errorText: string;
    try {
      errorText = await response.text();
      if (errorText.length > maxSize) {
        errorText = errorText.slice(0, maxSize) + '...[truncated]';
      }
    } catch {
      errorText = response.statusText;
    }
    return {
      content: [
        {
          type: 'text',
          text: `HTTP ${response.status}: ${errorText}`,
        },
      ],
      isError: true,
    };
  }

  if (isJson || isText) {
    let text = await response.text();
    if (isJson) {
      try {
        const parsed = JSON.parse(text);
        text = JSON.stringify(parsed, null, 2);
      } catch {
        // Return raw text if JSON parsing fails
      }
    }
    if (text.length > maxSize) {
      text = text.slice(0, maxSize) + '...[truncated]';
    }
    return {
      content: [{ type: 'text', text }],
    };
  }

  const size = response.headers.get('content-length') ?? 'unknown';
  return {
    content: [
      {
        type: 'text',
        text: `<binary response, ${contentType}, ${size} bytes>`,
      },
    ],
  };
}
