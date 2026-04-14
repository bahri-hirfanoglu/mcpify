import type { ParsedOperation, AuthConfig } from '../types.js';
import { applyAuth } from '../auth/handler.js';
import { sanitizeKey, restoreKeys } from '../sanitize.js';
import {
  shouldRetry,
  parseRetryAfter,
  computeBackoff,
  sleep,
  type RetryOptions,
  DEFAULT_RETRY,
} from './retry.js';
import { ResponseCache, cacheKey } from './cache.js';
import {
  parseLinkHeader,
  findNextUrlFromBody,
  findNextCursorFromBody,
  applyCursorToUrl,
  mergePages,
  type PaginationOptions,
  DEFAULT_PAGINATION,
} from './pagination.js';
import { selectFields } from './transform.js';

interface CallToolResult {
  content: Array<{ type: string; text: string }>;
  isError?: boolean;
}

export interface ExecuteOptions {
  maxResponseSize?: number;
  verbose?: boolean;
  customHeaders?: Record<string, string>;
  retry?: RetryOptions;
  cache?: ResponseCache;
  pagination?: PaginationOptions;
  responseFields?: string[];
}

export async function executeRequest(
  operation: ParsedOperation,
  args: Record<string, unknown>,
  baseUrl: string,
  auth: AuthConfig,
  maxResponseSizeOrOpts: number | ExecuteOptions = 50 * 1024,
  verbose: boolean = false,
  customHeaders?: Record<string, string>,
): Promise<CallToolResult> {
  const opts: ExecuteOptions = typeof maxResponseSizeOrOpts === 'number'
    ? { maxResponseSize: maxResponseSizeOrOpts, verbose, customHeaders }
    : maxResponseSizeOrOpts;

  const maxResponseSize = opts.maxResponseSize ?? 50 * 1024;
  const isVerbose = opts.verbose ?? false;
  const retry = opts.retry ?? DEFAULT_RETRY;
  const cache = opts.cache;
  const pagination = opts.pagination ?? DEFAULT_PAGINATION;
  const responseFields = opts.responseFields ?? [];

  try {
    const url = buildUrl(operation, args, baseUrl);
    const headers = await buildHeaders(operation, args, auth, opts.customHeaders);
    const body = buildBody(args, operation);

    const canCache =
      cache?.enabled === true &&
      operation.method.toUpperCase() === 'GET' &&
      body === undefined;

    if (canCache) {
      const cached = cache!.get(cacheKey(operation.method, url, headers));
      if (cached !== undefined) {
        if (isVerbose) process.stderr.write(`← cache ${operation.method} ${url}\n`);
        return postProcess(cached, responseFields, maxResponseSize, false);
      }
    }

    const doPagination =
      pagination.enabled &&
      operation.method.toUpperCase() === 'GET' &&
      pagination.maxPages > 1;

    if (doPagination) {
      return await executePaginated(
        operation,
        url,
        headers,
        pagination,
        retry,
        maxResponseSize,
        isVerbose,
        responseFields,
      );
    }

    const { response, duration, error } = await performRequest(
      operation.method,
      url,
      headers,
      body,
      retry,
      isVerbose,
    );

    if (error) {
      if (isVerbose) process.stderr.write(`← ✗ ERROR: ${error.message}\n`);
      return {
        content: [{ type: 'text', text: `Request failed: ${error.message}` }],
        isError: true,
      };
    }

    const result = await handleResponse(response!, maxResponseSize);

    if (isVerbose) {
      const size = result.content[0]?.text.length ?? 0;
      const status = response!.status;
      const icon = result.isError ? '✗' : '✓';
      process.stderr.write(`← ${icon} ${status} ${duration}ms ${formatSize(size)}\n`);
    }

    if (!result.isError && canCache) {
      cache!.set(cacheKey(operation.method, url, headers), result.content[0].text);
    }

    if (result.isError) return result;

    return postProcess(result.content[0].text, responseFields, maxResponseSize, false);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    if (isVerbose) process.stderr.write(`← ✗ ERROR: ${message}\n`);
    return {
      content: [{ type: 'text', text: `Request failed: ${message}` }],
      isError: true,
    };
  }
}

interface RequestOutcome {
  response?: Response;
  duration: number;
  error?: Error;
}

async function performRequest(
  method: string,
  url: string,
  headers: Record<string, string>,
  body: string | undefined,
  retry: RetryOptions,
  verbose: boolean,
): Promise<RequestOutcome> {
  let lastOutcome: RequestOutcome = { duration: 0 };

  for (let attempt = 0; attempt <= retry.retries; attempt++) {
    if (verbose && attempt > 0) {
      process.stderr.write(`⟳ retry ${attempt}/${retry.retries} ${method} ${url}\n`);
    } else if (verbose) {
      process.stderr.write(`→ ${method} ${url}\n`);
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30_000);
    const start = Date.now();

    try {
      const response = await fetch(url, {
        method,
        headers,
        body,
        signal: controller.signal,
      });
      const duration = Date.now() - start;
      lastOutcome = { response, duration };

      if (attempt < retry.retries && shouldRetry(response.status)) {
        const retryAfter = parseRetryAfter(response.headers.get('retry-after'));
        const backoff = computeBackoff(attempt, retry);
        const delay = Math.min(retryAfter ?? backoff, retry.maxDelayMs);
        await sleep(delay);
        continue;
      }

      return lastOutcome;
    } catch (err) {
      lastOutcome = {
        duration: Date.now() - start,
        error: err instanceof Error ? err : new Error(String(err)),
      };
      if (attempt < retry.retries) {
        const delay = computeBackoff(attempt, retry);
        await sleep(delay);
        continue;
      }
      return lastOutcome;
    } finally {
      clearTimeout(timeout);
    }
  }

  return lastOutcome;
}

async function executePaginated(
  operation: ParsedOperation,
  initialUrl: string,
  headers: Record<string, string>,
  pagination: PaginationOptions,
  retry: RetryOptions,
  maxResponseSize: number,
  verbose: boolean,
  responseFields: string[],
): Promise<CallToolResult> {
  const pages: unknown[] = [];
  let currentUrl: string | undefined = initialUrl;
  let pagesFetched = 0;
  let truncated = false;

  while (currentUrl && pagesFetched < pagination.maxPages) {
    const { response, duration, error } = await performRequest(
      operation.method,
      currentUrl,
      headers,
      undefined,
      retry,
      verbose,
    );

    if (error) {
      return {
        content: [{ type: 'text', text: `Request failed: ${error.message}` }],
        isError: true,
      };
    }

    const contentType = response!.headers.get('content-type') ?? '';
    if (!response!.ok) {
      const text = await response!.text();
      return {
        content: [{ type: 'text', text: `HTTP ${response!.status}: ${text}` }],
        isError: true,
      };
    }

    const rawText = await response!.text();
    if (verbose) {
      process.stderr.write(
        `← ✓ ${response!.status} ${duration}ms (page ${pagesFetched + 1})\n`,
      );
    }

    let body: unknown;
    try {
      body = contentType.includes('application/json') ? JSON.parse(rawText) : rawText;
    } catch {
      body = rawText;
    }

    pages.push(body);
    pagesFetched++;

    const linkHeader = response!.headers.get('link');
    const nextFromLink = parseLinkHeader(linkHeader)['next'];
    if (nextFromLink) {
      currentUrl = nextFromLink;
      continue;
    }

    const nextFromBody = findNextUrlFromBody(body, currentUrl);
    if (nextFromBody) {
      currentUrl = nextFromBody;
      continue;
    }

    const cursor = findNextCursorFromBody(body);
    if (cursor) {
      currentUrl = applyCursorToUrl(currentUrl, cursor);
      continue;
    }

    currentUrl = undefined;
  }

  if (pagesFetched === pagination.maxPages && currentUrl) truncated = true;

  const merged = mergePages(pages);
  const transformed = responseFields.length > 0 ? selectFields(merged, responseFields) : merged;
  let text = JSON.stringify(transformed, null, 2);
  if (truncated) text = `${text}\n[paginated: stopped at max-pages=${pagination.maxPages}]`;
  if (text.length > maxResponseSize) {
    text = text.slice(0, maxResponseSize) + '...[truncated]';
  }
  return { content: [{ type: 'text', text }] };
}

function postProcess(
  rawText: string,
  fields: string[],
  maxSize: number,
  isError: boolean,
): CallToolResult {
  if (isError) return { content: [{ type: 'text', text: rawText }], isError };
  if (fields.length === 0) {
    const text = rawText.length > maxSize ? rawText.slice(0, maxSize) + '...[truncated]' : rawText;
    return { content: [{ type: 'text', text }] };
  }

  try {
    const parsed = JSON.parse(rawText);
    const selected = selectFields(parsed, fields);
    let text = JSON.stringify(selected, null, 2);
    if (text.length > maxSize) text = text.slice(0, maxSize) + '...[truncated]';
    return { content: [{ type: 'text', text }] };
  } catch {
    const text = rawText.length > maxSize ? rawText.slice(0, maxSize) + '...[truncated]' : rawText;
    return { content: [{ type: 'text', text }] };
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
