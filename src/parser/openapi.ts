import SwaggerParser from '@apidevtools/swagger-parser';
import type { OpenAPI, OpenAPIV2, OpenAPIV3, OpenAPIV3_1 } from 'openapi-types';
import type {
  ParsedSpec,
  ParsedOperation,
  ParsedParameter,
  ParsedRequestBody,
  SecurityRequirement,
  SecurityScheme,
} from '../types.js';

type OAParameter = OpenAPIV3.ParameterObject;
type OARequestBody = OpenAPIV3.RequestBodyObject;
type OASecurityScheme = OpenAPIV3.SecuritySchemeObject;

function isSwagger2(api: OpenAPI.Document): api is OpenAPIV2.Document {
  return 'swagger' in api && (api as OpenAPIV2.Document).swagger === '2.0';
}

export async function parseSpec(source: string): Promise<ParsedSpec> {
  const api = await SwaggerParser.dereference(source);

  if (isSwagger2(api)) {
    return parseSwagger2(api);
  }

  return parseOpenAPI3(api as OpenAPIV3.Document | OpenAPIV3_1.Document);
}

// ── OpenAPI 3.x ──

function parseOpenAPI3(
  api: OpenAPIV3.Document | OpenAPIV3_1.Document,
): ParsedSpec {
  const title = api.info.title;
  const version = api.info.version;
  const description = api.info.description;
  const defaultServerUrl = resolveDefaultServerUrl(api);
  const securitySchemes = extractSecuritySchemes3(api);
  const rootSecurity = extractSecurity(api.security);

  const operations = extractOperations3(api, rootSecurity);

  return { title, version, description, defaultServerUrl, operations, securitySchemes };
}

function extractOperations3(
  api: OpenAPIV3.Document | OpenAPIV3_1.Document,
  rootSecurity: SecurityRequirement[],
): ParsedOperation[] {
  const operations: ParsedOperation[] = [];
  const idCounts = new Map<string, number>();

  for (const [path, pathItem] of Object.entries(api.paths ?? {})) {
    if (!pathItem) continue;

    const pathParams = extractParameters(
      (pathItem as OpenAPIV3.PathItemObject).parameters as OAParameter[] | undefined,
    );
    const pathServers = extractServerUrls(
      (pathItem as OpenAPIV3.PathItemObject).servers,
    );

    for (const method of HTTP_METHODS) {
      const op = (pathItem as Record<string, unknown>)[method] as
        | OpenAPIV3.OperationObject
        | undefined;
      if (!op) continue;

      const opParams = extractParameters(
        op.parameters as OAParameter[] | undefined,
      );
      const mergedParams = mergeParameters(pathParams, opParams);
      const requestBody = extractRequestBody(
        op.requestBody as OARequestBody | undefined,
      );
      const opSecurity = op.security
        ? extractSecurity(op.security)
        : rootSecurity;
      const opServers = extractServerUrls(op.servers);
      const servers =
        opServers.length > 0 ? opServers : pathServers.length > 0 ? pathServers : [];

      const operationId = deduplicateId(
        op.operationId ?? generateOperationId(method, path),
        idCounts,
      );

      const responseSchema = extractResponseSchema3(op);

      operations.push({
        operationId,
        method: method.toUpperCase(),
        path,
        summary: op.summary,
        description: op.description,
        tags: op.tags ?? [],
        parameters: mergedParams,
        requestBody,
        responseSchema,
        security: opSecurity,
        servers,
      });
    }
  }

  return operations;
}

function resolveDefaultServerUrl(
  api: OpenAPIV3.Document | OpenAPIV3_1.Document,
): string {
  const servers = api.servers;
  if (!servers || servers.length === 0) return 'http://localhost';
  const server = servers[0];
  let url = server.url;
  if (server.variables) {
    for (const [key, variable] of Object.entries(server.variables)) {
      url = url.replace(`{${key}}`, variable.default);
    }
  }
  return url;
}

function extractServerUrls(servers?: OpenAPIV3.ServerObject[]): string[] {
  if (!servers) return [];
  return servers.map((s) => s.url);
}

function extractSecuritySchemes3(
  api: OpenAPIV3.Document | OpenAPIV3_1.Document,
): Record<string, SecurityScheme> {
  const schemes: Record<string, SecurityScheme> = {};
  if (!api.components?.securitySchemes) return schemes;

  for (const [name, scheme] of Object.entries(api.components.securitySchemes)) {
    const s = scheme as OASecurityScheme;
    schemes[name] = {
      type: s.type as SecurityScheme['type'],
      scheme: (s as OpenAPIV3.HttpSecurityScheme).scheme,
      bearerFormat: (s as OpenAPIV3.HttpSecurityScheme).bearerFormat,
      name: (s as OpenAPIV3.ApiKeySecurityScheme).name,
      in: (s as OpenAPIV3.ApiKeySecurityScheme).in as 'header' | 'query' | 'cookie' | undefined,
      description: s.description,
    };
  }
  return schemes;
}

// ── Swagger 2.0 ──

function parseSwagger2(api: OpenAPIV2.Document): ParsedSpec {
  const title = api.info.title;
  const version = api.info.version;
  const description = api.info.description;
  const defaultServerUrl = resolveSwagger2BaseUrl(api);
  const securitySchemes = extractSecuritySchemes2(api);
  const rootSecurity = extractSecurity(
    api.security as OpenAPIV3.SecurityRequirementObject[] | undefined,
  );

  const operations = extractOperations2(api, rootSecurity);

  return { title, version, description, defaultServerUrl, operations, securitySchemes };
}

function resolveSwagger2BaseUrl(api: OpenAPIV2.Document): string {
  const scheme = api.schemes?.[0] ?? 'https';
  const host = api.host ?? 'localhost';
  const basePath = api.basePath ?? '';
  return `${scheme}://${host}${basePath}`;
}

function extractSecuritySchemes2(
  api: OpenAPIV2.Document,
): Record<string, SecurityScheme> {
  const schemes: Record<string, SecurityScheme> = {};
  if (!api.securityDefinitions) return schemes;

  for (const [name, scheme] of Object.entries(api.securityDefinitions)) {
    if (scheme.type === 'apiKey') {
      schemes[name] = {
        type: 'apiKey',
        name: scheme.name,
        in: scheme.in as 'header' | 'query',
        description: scheme.description,
      };
    } else if (scheme.type === 'basic') {
      schemes[name] = {
        type: 'http',
        scheme: 'basic',
        description: scheme.description,
      };
    } else if (scheme.type === 'oauth2') {
      schemes[name] = {
        type: 'oauth2',
        description: scheme.description,
      };
    }
  }
  return schemes;
}

function extractOperations2(
  api: OpenAPIV2.Document,
  rootSecurity: SecurityRequirement[],
): ParsedOperation[] {
  const operations: ParsedOperation[] = [];
  const idCounts = new Map<string, number>();

  for (const [path, pathItem] of Object.entries(api.paths ?? {})) {
    if (!pathItem) continue;

    const pathParams = extractSwagger2Params(
      (pathItem as OpenAPIV2.PathItemObject).parameters as OpenAPIV2.Parameter[] | undefined,
    );

    for (const method of HTTP_METHODS) {
      const op = (pathItem as Record<string, unknown>)[method] as
        | OpenAPIV2.OperationObject
        | undefined;
      if (!op) continue;

      const opParams = extractSwagger2Params(
        op.parameters as OpenAPIV2.Parameter[] | undefined,
      );
      const allParams = mergeParameters(pathParams.params, opParams.params);

      // In Swagger 2.0, body comes from "in: body" parameter
      const requestBody = opParams.body ?? pathParams.body;

      const opSecurity = op.security
        ? extractSecurity(op.security as OpenAPIV3.SecurityRequirementObject[])
        : rootSecurity;

      const operationId = deduplicateId(
        op.operationId ?? generateOperationId(method, path),
        idCounts,
      );

      const responseSchema = extractResponseSchema2(op);

      operations.push({
        operationId,
        method: method.toUpperCase(),
        path,
        summary: op.summary,
        description: op.description,
        tags: op.tags ?? [],
        parameters: allParams,
        requestBody,
        responseSchema,
        security: opSecurity,
        servers: [],
      });
    }
  }

  return operations;
}

function extractSwagger2Params(
  params?: OpenAPIV2.Parameter[],
): { params: ParsedParameter[]; body?: ParsedRequestBody } {
  if (!params) return { params: [] };

  const parsed: ParsedParameter[] = [];
  let body: ParsedRequestBody | undefined;

  for (const p of params) {
    if (!('in' in p)) continue;

    if (p.in === 'body') {
      const bp = p as OpenAPIV2.InBodyParameterObject;
      if (bp.schema) {
        body = {
          required: bp.required ?? false,
          contentType: 'application/json',
          schema: bp.schema as Record<string, unknown>,
        };
      }
      continue;
    }

    const gp = p as OpenAPIV2.GeneralParameterObject;
    parsed.push({
      name: gp.name,
      in: gp.in as ParsedParameter['in'],
      required: gp.required ?? gp.in === 'path',
      schema: swagger2ParamToSchema(gp),
      description: gp.description,
    });
  }

  return { params: parsed, body };
}

function swagger2ParamToSchema(
  p: OpenAPIV2.GeneralParameterObject,
): Record<string, unknown> {
  const schema: Record<string, unknown> = { type: p.type ?? 'string' };
  if (p.format) schema.format = p.format;
  if (p.enum) schema.enum = p.enum;
  if (p.default !== undefined) schema.default = p.default;
  if (p.minimum !== undefined) schema.minimum = p.minimum;
  if (p.maximum !== undefined) schema.maximum = p.maximum;
  if (p.type === 'array' && p.items) schema.items = p.items;
  return schema;
}

function extractResponseSchema3(
  op: OpenAPIV3.OperationObject,
): Record<string, unknown> | undefined {
  if (!op.responses) return undefined;

  for (const code of ['200', '201', '202', 'default']) {
    const resp = op.responses[code] as OpenAPIV3.ResponseObject | undefined;
    if (!resp?.content) continue;

    const jsonContent = resp.content['application/json'];
    if (jsonContent?.schema) {
      return jsonContent.schema as Record<string, unknown>;
    }
  }

  return undefined;
}

function extractResponseSchema2(
  op: OpenAPIV2.OperationObject,
): Record<string, unknown> | undefined {
  if (!op.responses) return undefined;

  for (const code of ['200', '201', '202', 'default']) {
    const resp = op.responses[code] as OpenAPIV2.Response | undefined;
    if (resp && 'schema' in resp && resp.schema) {
      return resp.schema as Record<string, unknown>;
    }
  }

  return undefined;
}

// ── Shared ──

const HTTP_METHODS = [
  'get', 'post', 'put', 'patch', 'delete', 'head', 'options', 'trace',
] as const;

function extractSecurity(
  security?: OpenAPIV3.SecurityRequirementObject[],
): SecurityRequirement[] {
  if (!security) return [];
  return security.flatMap((req) =>
    Object.entries(req).map(([name, scopes]) => ({ name, scopes })),
  );
}

function extractParameters(params?: OAParameter[]): ParsedParameter[] {
  if (!params) return [];
  return params
    .filter((p): p is OAParameter => 'name' in p && 'in' in p)
    .map((p) => ({
      name: p.name,
      in: p.in as ParsedParameter['in'],
      required: p.required ?? p.in === 'path',
      schema: (p.schema as Record<string, unknown>) ?? { type: 'string' },
      description: p.description,
    }));
}

function mergeParameters(
  pathParams: ParsedParameter[],
  opParams: ParsedParameter[],
): ParsedParameter[] {
  const merged = new Map<string, ParsedParameter>();
  for (const p of pathParams) merged.set(`${p.in}:${p.name}`, p);
  for (const p of opParams) merged.set(`${p.in}:${p.name}`, p);
  return [...merged.values()];
}

function extractRequestBody(body?: OARequestBody): ParsedRequestBody | undefined {
  if (!body?.content) return undefined;

  const jsonContent = body.content['application/json'];
  if (jsonContent?.schema) {
    return {
      required: body.required ?? false,
      contentType: 'application/json',
      schema: jsonContent.schema as Record<string, unknown>,
    };
  }

  const firstEntry = Object.entries(body.content)[0];
  if (firstEntry?.[1]?.schema) {
    return {
      required: body.required ?? false,
      contentType: firstEntry[0],
      schema: firstEntry[1].schema as Record<string, unknown>,
    };
  }

  return undefined;
}

function generateOperationId(method: string, path: string): string {
  const segments = path
    .split('/')
    .filter(Boolean)
    .map((s) => (s.startsWith('{') && s.endsWith('}') ? `by_${s.slice(1, -1)}` : s))
    .join('_');
  return `${method}_${segments || 'root'}`;
}

function deduplicateId(
  id: string,
  counts: Map<string, number>,
): string {
  const count = counts.get(id) ?? 0;
  counts.set(id, count + 1);
  if (count > 0) {
    const newId = `${id}_${count + 1}`;
    process.stderr.write(
      `Warning: duplicate operationId "${id}", renaming to "${newId}"\n`,
    );
    return newId;
  }
  return id;
}
