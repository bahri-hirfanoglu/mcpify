import { parseSpec } from '../parser/openapi.js';
import { generateTools } from '../generator/tools.js';
import type { ParsedSpec, ParsedOperation } from '../types.js';

export type IssueLevel = 'info' | 'warn' | 'error';

export interface ValidationIssue {
  level: IssueLevel;
  message: string;
  operationId?: string;
}

export interface ValidationReport {
  spec: {
    title: string;
    version: string;
    baseUrl: string;
  };
  operationCount: number;
  toolCount: number;
  securitySchemes: Array<{ name: string; type: string; supported: boolean }>;
  issues: ValidationIssue[];
  errorCount: number;
  warnCount: number;
  infoCount: number;
}

export async function runValidate(
  specSource: string,
): Promise<ValidationReport> {
  const spec = await parseSpec(specSource);
  return analyzeSpec(spec);
}

export function analyzeSpec(spec: ParsedSpec): ValidationReport {
  const issues: ValidationIssue[] = [];
  const tools = generateTools(spec.operations);

  for (const op of spec.operations) {
    checkOperation(op, issues);
  }

  const securitySchemes = Object.entries(spec.securitySchemes).map(
    ([name, scheme]) => {
      const supported = isSchemeSupported(scheme.type, scheme);
      return {
        name,
        type: formatSchemeType(scheme.type, scheme),
        supported,
      };
    },
  );

  checkSecuritySchemes(spec, issues);
  checkDuplicateToolNames(tools.map((t) => t.name), issues);

  if (spec.operations.length === 0) {
    issues.push({
      level: 'error',
      message: 'spec contains no operations',
    });
  }

  return {
    spec: {
      title: spec.title,
      version: spec.version,
      baseUrl: spec.defaultServerUrl,
    },
    operationCount: spec.operations.length,
    toolCount: tools.length,
    securitySchemes,
    issues,
    errorCount: issues.filter((i) => i.level === 'error').length,
    warnCount: issues.filter((i) => i.level === 'warn').length,
    infoCount: issues.filter((i) => i.level === 'info').length,
  };
}

function checkOperation(
  op: ParsedOperation,
  issues: ValidationIssue[],
): void {
  if (op.requestBody && op.requestBody.contentType !== 'application/json') {
    issues.push({
      level: 'warn',
      message: `non-JSON request body (${op.requestBody.contentType}) — mcpify sends JSON only`,
      operationId: op.operationId,
    });
  }

  if (!op.responseSchema && isGetMethod(op.method)) {
    issues.push({
      level: 'info',
      message: 'no response schema — tool description will lack return hints',
      operationId: op.operationId,
    });
  }

  // Long descriptions get truncated in tool output
  if (op.description && op.description.length > 1024) {
    issues.push({
      level: 'info',
      message: 'description exceeds 1024 chars — will be truncated in tool output',
      operationId: op.operationId,
    });
  }
}

function isGetMethod(method: string): boolean {
  return method === 'GET' || method === 'HEAD';
}

function checkSecuritySchemes(
  spec: ParsedSpec,
  issues: ValidationIssue[],
): void {
  for (const [name, scheme] of Object.entries(spec.securitySchemes)) {
    if (scheme.type === 'openIdConnect') {
      issues.push({
        level: 'warn',
        message:
          `security scheme "${name}" is OpenID Connect — mcpify does not auto-discover the tokenUrl. Provide --oauth-token-url manually`,
      });
      continue;
    }

    if (scheme.type === 'oauth2') {
      const flows = scheme.flows ?? {};
      const supportedFlow =
        flows.clientCredentials?.tokenUrl || flows.authorizationCode?.tokenUrl;
      if (!supportedFlow) {
        issues.push({
          level: 'warn',
          message:
            `security scheme "${name}" oauth2 has no clientCredentials or authorizationCode flow — only these two are supported`,
        });
      }
      if (flows.implicit && !supportedFlow) {
        issues.push({
          level: 'warn',
          message:
            `security scheme "${name}" uses implicit flow — not supported, please migrate to authorizationCode`,
        });
      }
      continue;
    }

    if (scheme.type === 'http') {
      const s = (scheme.scheme ?? '').toLowerCase();
      if (s !== 'bearer' && s !== 'basic') {
        issues.push({
          level: 'warn',
          message: `security scheme "${name}" http/${scheme.scheme} — only bearer is fully supported`,
        });
      } else if (s === 'basic') {
        issues.push({
          level: 'warn',
          message: `security scheme "${name}" uses HTTP Basic — not currently applied by mcpify; set --bearer-token or --api-key-* instead`,
        });
      }
      continue;
    }

    if (scheme.type === 'apiKey') {
      if (scheme.in && scheme.in !== 'header') {
        issues.push({
          level: 'warn',
          message: `security scheme "${name}" apiKey is placed in "${scheme.in}" — only header placement is applied automatically`,
        });
      }
    }
  }
}

function checkDuplicateToolNames(
  names: string[],
  issues: ValidationIssue[],
): void {
  const seen = new Set<string>();
  const dupes = new Set<string>();
  for (const name of names) {
    if (seen.has(name)) dupes.add(name);
    seen.add(name);
  }
  for (const dupe of dupes) {
    issues.push({
      level: 'error',
      message: `duplicate tool name "${dupe}" — rename operations or adjust --prefix`,
    });
  }
}

function isSchemeSupported(
  type: string,
  scheme: ParsedSpec['securitySchemes'][string],
): boolean {
  if (type === 'http') {
    return scheme.scheme?.toLowerCase() === 'bearer';
  }
  if (type === 'apiKey') {
    return scheme.in === 'header';
  }
  if (type === 'oauth2') {
    return !!(
      scheme.flows?.clientCredentials?.tokenUrl ||
      scheme.flows?.authorizationCode?.tokenUrl
    );
  }
  return false;
}

function formatSchemeType(
  type: string,
  scheme: ParsedSpec['securitySchemes'][string],
): string {
  if (type === 'http') return `http/${scheme.scheme ?? '?'}`;
  if (type === 'apiKey') return `apiKey/${scheme.in ?? '?'}`;
  if (type === 'oauth2') {
    const flows = Object.keys(scheme.flows ?? {}).join(',') || 'no flows';
    return `oauth2 (${flows})`;
  }
  return type;
}

export function formatReport(report: ValidationReport): string {
  const lines: string[] = [];
  const { spec } = report;

  lines.push('');
  lines.push(`${spec.title} v${spec.version}`);
  lines.push(`Base URL: ${spec.baseUrl}`);
  lines.push('');
  lines.push(`Operations: ${report.operationCount}`);
  lines.push(`Tools:      ${report.toolCount}`);

  if (report.securitySchemes.length > 0) {
    lines.push('');
    lines.push('Security schemes:');
    for (const scheme of report.securitySchemes) {
      const marker = scheme.supported ? '✓' : '⚠';
      lines.push(`  ${marker} ${scheme.name} (${scheme.type})`);
    }
  }

  if (report.issues.length > 0) {
    lines.push('');
    lines.push('Issues:');
    for (const issue of report.issues) {
      const marker =
        issue.level === 'error' ? '✗' : issue.level === 'warn' ? '⚠' : 'ℹ';
      const scope = issue.operationId ? ` [${issue.operationId}]` : '';
      lines.push(`  ${marker}${scope} ${issue.message}`);
    }
  }

  lines.push('');
  const summary: string[] = [];
  if (report.errorCount > 0) summary.push(`${report.errorCount} error(s)`);
  if (report.warnCount > 0) summary.push(`${report.warnCount} warning(s)`);
  if (report.infoCount > 0) summary.push(`${report.infoCount} info`);
  if (summary.length === 0) {
    lines.push('✓ PASS — no issues');
  } else {
    const verdict = report.errorCount > 0 ? '✗ FAIL' : '⚠ PASS with warnings';
    lines.push(`${verdict} — ${summary.join(', ')}`);
  }
  lines.push('');

  return lines.join('\n');
}
