import type { ParsedOperation, AuthConfig } from '../types.js';
import { applyAuth } from '../auth/handler.js';

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
): Promise<CallToolResult> {
  try {
    const url = buildUrl(operation, args, baseUrl);
    const headers = buildHeaders(operation, args, auth);
    const body = buildBody(args);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30_000);

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

    return await handleResponse(response, maxResponseSize);
  } catch (err) {
    const message =
      err instanceof Error ? err.message : 'Unknown error';
    return {
      content: [{ type: 'text', text: `Request failed: ${message}` }],
      isError: true,
    };
  }
}

function buildUrl(
  operation: ParsedOperation,
  args: Record<string, unknown>,
  baseUrl: string,
): string {
  let path = operation.path;

  // Substitute path parameters
  for (const param of operation.parameters) {
    if (param.in === 'path' && args[param.name] != null) {
      path = path.replace(
        `{${param.name}}`,
        encodeURIComponent(String(args[param.name])),
      );
    }
  }

  const url = new URL(path, baseUrl.endsWith('/') ? baseUrl : baseUrl + '/');

  // Add query parameters
  for (const param of operation.parameters) {
    if (param.in === 'query' && args[param.name] != null) {
      url.searchParams.set(param.name, String(args[param.name]));
    }
  }

  return url.toString();
}

function buildHeaders(
  operation: ParsedOperation,
  args: Record<string, unknown>,
  auth: AuthConfig,
): Record<string, string> {
  const headers: Record<string, string> = {
    Accept: 'application/json',
  };

  if (operation.requestBody) {
    headers['Content-Type'] = operation.requestBody.contentType;
  }

  // Merge custom headers from _headers arg
  const customHeaders = args._headers as
    | Record<string, unknown>
    | undefined;
  if (customHeaders) {
    for (const [key, value] of Object.entries(customHeaders)) {
      if (value != null) headers[key] = String(value);
    }
  }

  applyAuth(headers, auth);

  return headers;
}

function buildBody(args: Record<string, unknown>): string | undefined {
  if (args._body == null) return undefined;
  return JSON.stringify(args._body);
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

  // Binary response
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
