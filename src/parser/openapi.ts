import SwaggerParser from '@apidevtools/swagger-parser';
import type { OpenAPIV3, OpenAPIV3_1 } from 'openapi-types';
import type {
  ParsedSpec,
  ParsedOperation,
  ParsedParameter,
  ParsedRequestBody,
  SecurityRequirement,
  SecurityScheme,
} from '../types.js';

type OADocument = OpenAPIV3.Document | OpenAPIV3_1.Document;
type OAOperation = OpenAPIV3.OperationObject | OpenAPIV3_1.OperationObject;
type OAParameter = OpenAPIV3.ParameterObject;
type OARequestBody = OpenAPIV3.RequestBodyObject;
type OASecurityScheme = OpenAPIV3.SecuritySchemeObject;

export async function parseSpec(source: string): Promise<ParsedSpec> {
  const api = (await SwaggerParser.dereference(source)) as OADocument;

  const title = api.info.title;
  const version = api.info.version;
  const description = api.info.description;
  const defaultServerUrl = resolveDefaultServerUrl(api);
  const securitySchemes = extractSecuritySchemes(api);
  const rootSecurity = extractSecurity(
    (api as OpenAPIV3.Document).security,
  );

  const operations: ParsedOperation[] = [];
  const idCounts = new Map<string, number>();

  for (const [path, pathItem] of Object.entries(api.paths ?? {})) {
    if (!pathItem) continue;

    const pathParams = extractParameters(
      (pathItem as OpenAPIV3.PathItemObject).parameters as OpenAPIV3.ParameterObject[] | undefined,
    );
    const pathServers = extractServerUrls(
      (pathItem as OpenAPIV3.PathItemObject).servers,
    );

    for (const method of [
      'get', 'post', 'put', 'patch', 'delete', 'head', 'options', 'trace',
    ] as const) {
      const op = (pathItem as Record<string, unknown>)[method] as
        | OAOperation
        | undefined;
      if (!op) continue;

      const opParams = extractParameters(
        op.parameters as OpenAPIV3.ParameterObject[] | undefined,
      );
      const mergedParams = mergeParameters(pathParams, opParams);

      const requestBody = extractRequestBody(
        op.requestBody as OARequestBody | undefined,
      );

      const opSecurity = op.security
        ? extractSecurity(op.security)
        : rootSecurity;

      const opServers = extractServerUrls(
        (op as OpenAPIV3.OperationObject).servers,
      );
      const servers =
        opServers.length > 0
          ? opServers
          : pathServers.length > 0
            ? pathServers
            : [];

      let operationId =
        op.operationId ?? generateOperationId(method, path);

      const count = idCounts.get(operationId) ?? 0;
      idCounts.set(operationId, count + 1);
      if (count > 0) {
        const newId = `${operationId}_${count + 1}`;
        process.stderr.write(
          `Warning: duplicate operationId "${operationId}", renaming to "${newId}"\n`,
        );
        operationId = newId;
      }

      operations.push({
        operationId,
        method: method.toUpperCase(),
        path,
        summary: op.summary,
        description: op.description,
        tags: op.tags ?? [],
        parameters: mergedParams,
        requestBody,
        security: opSecurity,
        servers,
      });
    }
  }

  return {
    title,
    version,
    description,
    defaultServerUrl,
    operations,
    securitySchemes,
  };
}

function resolveDefaultServerUrl(api: OADocument): string {
  const servers = (api as OpenAPIV3.Document).servers;
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

function extractServerUrls(
  servers?: OpenAPIV3.ServerObject[],
): string[] {
  if (!servers) return [];
  return servers.map((s) => s.url);
}

function extractSecuritySchemes(
  api: OADocument,
): Record<string, SecurityScheme> {
  const schemes: Record<string, SecurityScheme> = {};
  const components = (api as OpenAPIV3.Document).components;
  if (!components?.securitySchemes) return schemes;

  for (const [name, scheme] of Object.entries(
    components.securitySchemes,
  )) {
    const s = scheme as OASecurityScheme;
    schemes[name] = {
      type: s.type as SecurityScheme['type'],
      scheme: (s as OpenAPIV3.HttpSecurityScheme).scheme,
      bearerFormat: (s as OpenAPIV3.HttpSecurityScheme).bearerFormat,
      name: (s as OpenAPIV3.ApiKeySecurityScheme).name,
      in: (s as OpenAPIV3.ApiKeySecurityScheme).in as
        | 'header'
        | 'query'
        | 'cookie'
        | undefined,
      description: s.description,
    };
  }
  return schemes;
}

function extractSecurity(
  security?: OpenAPIV3.SecurityRequirementObject[],
): SecurityRequirement[] {
  if (!security) return [];
  return security.flatMap((req) =>
    Object.entries(req).map(([name, scopes]) => ({
      name,
      scopes: scopes,
    })),
  );
}

function extractParameters(
  params?: OpenAPIV3.ParameterObject[],
): ParsedParameter[] {
  if (!params) return [];
  return params
    .filter(
      (p): p is OAParameter => 'name' in p && 'in' in p,
    )
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
  for (const p of pathParams) {
    merged.set(`${p.in}:${p.name}`, p);
  }
  for (const p of opParams) {
    merged.set(`${p.in}:${p.name}`, p);
  }
  return [...merged.values()];
}

function extractRequestBody(
  body?: OARequestBody,
): ParsedRequestBody | undefined {
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
