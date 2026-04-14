import { parseSpec } from '../parser/openapi.js';
import { resolveAuth, applyAuth } from '../auth/handler.js';
import { joinBaseUrl } from '../runtime/http-client.js';
import type { AuthConfig, ParsedOperation } from '../types.js';
import type { AuthOptions } from '../auth/handler.js';

export interface TestCommandOptions {
  auth?: AuthOptions;
  baseUrl?: string;
  filterIds?: string[];
  timeoutMs?: number;
  customHeaders?: Record<string, string>;
}

export interface OperationTestResult {
  operationId: string;
  method: string;
  path: string;
  status: 'ok' | 'fail' | 'skipped';
  httpStatus?: number;
  durationMs?: number;
  reason?: string;
}

export interface TestReport {
  baseUrl: string;
  results: OperationTestResult[];
  ok: number;
  fail: number;
  skipped: number;
}

export async function runTest(
  specSource: string,
  opts: TestCommandOptions = {},
): Promise<TestReport> {
  const spec = await parseSpec(specSource);
  const auth = resolveAuth(opts.auth ?? {}, spec);
  const baseUrl = opts.baseUrl ?? spec.defaultServerUrl;
  const timeout = opts.timeoutMs ?? 10_000;

  const targets = filterTestable(spec.operations, opts.filterIds);
  const results: OperationTestResult[] = [];

  for (const op of spec.operations) {
    if (!targets.has(op.operationId)) {
      results.push({
        operationId: op.operationId,
        method: op.method,
        path: op.path,
        status: 'skipped',
        reason: op.method !== 'GET' && op.method !== 'HEAD' ? 'non-safe method' : 'requires parameters',
      });
      continue;
    }

    results.push(await probe(op, baseUrl, auth, timeout, opts.customHeaders));
  }

  return {
    baseUrl,
    results,
    ok: results.filter((r) => r.status === 'ok').length,
    fail: results.filter((r) => r.status === 'fail').length,
    skipped: results.filter((r) => r.status === 'skipped').length,
  };
}

function filterTestable(
  operations: ParsedOperation[],
  filterIds?: string[],
): Set<string> {
  const ids = new Set<string>();
  for (const op of operations) {
    if (filterIds && !filterIds.includes(op.operationId)) continue;
    if (op.method !== 'GET' && op.method !== 'HEAD') continue;
    const hasRequiredParams = op.parameters.some(
      (p) => p.required && (p.in === 'path' || p.in === 'query' || p.in === 'header'),
    );
    if (hasRequiredParams) continue;
    ids.add(op.operationId);
  }
  return ids;
}

async function probe(
  op: ParsedOperation,
  baseUrl: string,
  auth: AuthConfig,
  timeoutMs: number,
  customHeaders?: Record<string, string>,
): Promise<OperationTestResult> {
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (customHeaders) Object.assign(headers, customHeaders);

  try {
    await applyAuth(headers, auth);
  } catch (err) {
    return {
      operationId: op.operationId,
      method: op.method,
      path: op.path,
      status: 'fail',
      reason: `auth failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  const url = joinBaseUrl(baseUrl, op.path).toString();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const start = Date.now();

  try {
    const response = await fetch(url, {
      method: op.method,
      headers,
      signal: controller.signal,
    });
    const duration = Date.now() - start;

    if (response.ok) {
      return {
        operationId: op.operationId,
        method: op.method,
        path: op.path,
        status: 'ok',
        httpStatus: response.status,
        durationMs: duration,
      };
    }
    return {
      operationId: op.operationId,
      method: op.method,
      path: op.path,
      status: 'fail',
      httpStatus: response.status,
      durationMs: duration,
      reason: `HTTP ${response.status}`,
    };
  } catch (err) {
    return {
      operationId: op.operationId,
      method: op.method,
      path: op.path,
      status: 'fail',
      durationMs: Date.now() - start,
      reason: err instanceof Error ? err.message : String(err),
    };
  } finally {
    clearTimeout(timer);
  }
}

export function formatTestReport(report: TestReport): string {
  const lines: string[] = [];
  lines.push('');
  lines.push(`Base URL: ${report.baseUrl}`);
  lines.push(`Operations: ${report.results.length}  (ok: ${report.ok}, fail: ${report.fail}, skipped: ${report.skipped})`);
  lines.push('');

  for (const r of report.results) {
    const icon = r.status === 'ok' ? '✓' : r.status === 'fail' ? '✗' : '∘';
    const suffix = r.status === 'ok'
      ? ` ${r.httpStatus} ${r.durationMs}ms`
      : r.status === 'fail'
        ? ` ${r.reason ?? ''}`
        : ` (${r.reason ?? 'skipped'})`;
    lines.push(`  ${icon} ${r.operationId}  ${r.method} ${r.path}${suffix}`);
  }
  lines.push('');
  return lines.join('\n');
}
