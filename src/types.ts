export interface ParsedParameter {
  name: string;
  in: 'path' | 'query' | 'header' | 'cookie';
  required: boolean;
  schema: Record<string, unknown>;
  description?: string;
}

export interface ParsedRequestBody {
  required: boolean;
  contentType: string;
  schema: Record<string, unknown>;
}

export interface SecurityRequirement {
  name: string;
  scopes: string[];
}

export interface SecurityScheme {
  type: 'http' | 'apiKey' | 'oauth2' | 'openIdConnect';
  scheme?: string;
  bearerFormat?: string;
  name?: string;
  in?: 'header' | 'query' | 'cookie';
  description?: string;
}

export interface ParsedOperation {
  operationId: string;
  method: string;
  path: string;
  summary?: string;
  description?: string;
  tags: string[];
  parameters: ParsedParameter[];
  requestBody?: ParsedRequestBody;
  security: SecurityRequirement[];
  servers: string[];
}

export interface ParsedSpec {
  title: string;
  version: string;
  description?: string;
  defaultServerUrl: string;
  operations: ParsedOperation[];
  securitySchemes: Record<string, SecurityScheme>;
}

export type AuthConfig =
  | { type: 'bearer'; token: string }
  | { type: 'api-key'; headerName: string; value: string }
  | { type: 'none' };

export interface McpToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  annotations?: {
    readOnlyHint?: boolean;
    destructiveHint?: boolean;
  };
}

export interface FilterOptions {
  include?: string[];
  exclude?: string[];
  tags?: string[];
  naming?: 'camelCase' | 'snake_case' | 'original';
  prefix?: string;
}

export interface ServerConfig {
  spec: ParsedSpec;
  tools: McpToolDefinition[];
  operations: ParsedOperation[];
  baseUrl: string;
  auth: AuthConfig;
  transport: 'stdio' | 'http';
  port: number;
  maxResponseSize: number;
  verbose?: boolean;
}
