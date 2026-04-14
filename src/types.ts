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

export interface OAuthFlowDefinition {
  authorizationUrl?: string;
  tokenUrl?: string;
  refreshUrl?: string;
  scopes: Record<string, string>;
}

export type OAuthFlowName =
  | 'implicit'
  | 'password'
  | 'clientCredentials'
  | 'authorizationCode';

export interface SecurityScheme {
  type: 'http' | 'apiKey' | 'oauth2' | 'openIdConnect';
  scheme?: string;
  bearerFormat?: string;
  name?: string;
  in?: 'header' | 'query' | 'cookie';
  description?: string;
  flows?: Partial<Record<OAuthFlowName, OAuthFlowDefinition>>;
  openIdConnectUrl?: string;
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
  responseSchema?: Record<string, unknown>;
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
  | { type: 'oauth2'; tokenManager: import('./auth/oauth.js').TokenManager }
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

export interface RetryConfig {
  retries: number;
  baseDelayMs: number;
  maxDelayMs: number;
}

export interface CacheConfig {
  ttlMs: number;
  maxEntries: number;
}

export interface PaginationConfig {
  enabled: boolean;
  maxPages: number;
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
  customHeaders?: Record<string, string>;
  verbose?: boolean;
  retry?: RetryConfig;
  cache?: CacheConfig;
  pagination?: PaginationConfig;
  responseFields?: string[];
}
