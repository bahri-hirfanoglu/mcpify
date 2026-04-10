import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { runValidate, analyzeSpec, formatReport } from '../src/commands/validate.js';
import type { ParsedSpec } from '../src/types.js';

const fixture = (name: string) =>
  path.resolve(import.meta.dirname, 'fixtures', name);

describe('runValidate', () => {
  it('reports a clean petstore as passing', async () => {
    const report = await runValidate(fixture('petstore.yaml'));

    expect(report.spec.title).toBe('Petstore API');
    expect(report.spec.version).toBe('1.0.0');
    expect(report.operationCount).toBe(4);
    expect(report.toolCount).toBe(4);
    expect(report.errorCount).toBe(0);
    expect(report.securitySchemes).toEqual([
      { name: 'bearerAuth', type: 'http/bearer', supported: true },
    ]);
  });

  it('reports oauth2 scheme as supported when clientCredentials flow exists', async () => {
    const report = await runValidate(fixture('oauth.yaml'));

    const oauthScheme = report.securitySchemes.find((s) => s.name === 'oauth');
    expect(oauthScheme?.supported).toBe(true);
    expect(oauthScheme?.type).toContain('oauth2');

    const oidcScheme = report.securitySchemes.find((s) => s.name === 'oidc');
    expect(oidcScheme?.supported).toBe(false);

    // OIDC warning should be present
    const oidcIssue = report.issues.find(
      (i) => i.message.includes('OpenID Connect') && i.level === 'warn',
    );
    expect(oidcIssue).toBeDefined();
  });
});

describe('analyzeSpec', () => {
  const emptySpec: ParsedSpec = {
    title: 'Empty',
    version: '1.0',
    defaultServerUrl: 'http://localhost',
    operations: [],
    securitySchemes: {},
  };

  it('reports error when spec has no operations', () => {
    const report = analyzeSpec(emptySpec);
    expect(report.errorCount).toBe(1);
    expect(report.issues[0].message).toContain('no operations');
  });

  it('reports error on duplicate tool names', () => {
    const spec: ParsedSpec = {
      ...emptySpec,
      operations: [
        {
          operationId: 'dupe',
          method: 'GET',
          path: '/a',
          tags: [],
          parameters: [],
          security: [],
          servers: [],
        },
        {
          operationId: 'dupe',
          method: 'POST',
          path: '/b',
          tags: [],
          parameters: [],
          security: [],
          servers: [],
        },
      ],
    };
    const report = analyzeSpec(spec);
    const dupeIssue = report.issues.find((i) => i.message.includes('duplicate'));
    expect(dupeIssue?.level).toBe('error');
  });

  it('warns on non-JSON request body', () => {
    const spec: ParsedSpec = {
      ...emptySpec,
      operations: [
        {
          operationId: 'upload',
          method: 'POST',
          path: '/upload',
          tags: [],
          parameters: [],
          security: [],
          servers: [],
          requestBody: {
            required: true,
            contentType: 'multipart/form-data',
            schema: { type: 'object' },
          },
        },
      ],
    };
    const report = analyzeSpec(spec);
    const issue = report.issues.find((i) => i.message.includes('multipart'));
    expect(issue?.level).toBe('warn');
    expect(issue?.operationId).toBe('upload');
  });

  it('warns on http basic auth scheme', () => {
    const spec: ParsedSpec = {
      ...emptySpec,
      operations: [
        {
          operationId: 'op',
          method: 'GET',
          path: '/',
          tags: [],
          parameters: [],
          security: [],
          servers: [],
        },
      ],
      securitySchemes: {
        basic: { type: 'http', scheme: 'basic' },
      },
    };
    const report = analyzeSpec(spec);
    const issue = report.issues.find((i) => i.message.includes('HTTP Basic'));
    expect(issue?.level).toBe('warn');
  });

  it('warns on apiKey not in header', () => {
    const spec: ParsedSpec = {
      ...emptySpec,
      operations: [
        {
          operationId: 'op',
          method: 'GET',
          path: '/',
          tags: [],
          parameters: [],
          security: [],
          servers: [],
        },
      ],
      securitySchemes: {
        keyInQuery: { type: 'apiKey', name: 'api_key', in: 'query' },
      },
    };
    const report = analyzeSpec(spec);
    const issue = report.issues.find((i) => i.message.includes('in "query"'));
    expect(issue?.level).toBe('warn');
  });

  it('marks spec with only info issues as a pass with warnings 0', () => {
    const spec: ParsedSpec = {
      ...emptySpec,
      operations: [
        {
          operationId: 'getNothing',
          method: 'GET',
          path: '/nothing',
          tags: [],
          parameters: [],
          security: [],
          servers: [],
        },
      ],
    };
    const report = analyzeSpec(spec);
    expect(report.errorCount).toBe(0);
    // Info about missing response schema
    const info = report.issues.find((i) => i.level === 'info');
    expect(info).toBeDefined();
  });
});

describe('formatReport', () => {
  it('renders PASS for clean spec', () => {
    const output = formatReport({
      spec: { title: 'API', version: '1', baseUrl: 'http://x' },
      operationCount: 1,
      toolCount: 1,
      securitySchemes: [],
      issues: [],
      errorCount: 0,
      warnCount: 0,
      infoCount: 0,
    });
    expect(output).toContain('PASS — no issues');
  });

  it('renders FAIL for error', () => {
    const output = formatReport({
      spec: { title: 'API', version: '1', baseUrl: 'http://x' },
      operationCount: 0,
      toolCount: 0,
      securitySchemes: [],
      issues: [{ level: 'error', message: 'bad' }],
      errorCount: 1,
      warnCount: 0,
      infoCount: 0,
    });
    expect(output).toContain('FAIL');
    expect(output).toContain('1 error');
  });
});
