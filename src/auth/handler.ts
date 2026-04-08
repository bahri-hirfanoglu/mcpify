import type { AuthConfig, ParsedSpec } from '../types.js';

export function applyAuth(
  headers: Record<string, string>,
  auth: AuthConfig,
): void {
  switch (auth.type) {
    case 'bearer':
      headers['Authorization'] = `Bearer ${auth.token}`;
      break;
    case 'api-key':
      headers[auth.headerName] = auth.value;
      break;
    case 'none':
      break;
  }
}

export interface AuthOptions {
  bearerToken?: string;
  apiKeyHeader?: string;
  apiKeyValue?: string;
}

export function resolveAuth(
  options: AuthOptions,
  spec: ParsedSpec,
): AuthConfig {
  const token =
    options.bearerToken ?? process.env.MCPIFY_BEARER_TOKEN;
  if (token) {
    return { type: 'bearer', token };
  }

  const header =
    options.apiKeyHeader ?? process.env.MCPIFY_API_KEY_HEADER;
  const value =
    options.apiKeyValue ?? process.env.MCPIFY_API_KEY_VALUE;
  if (header && value) {
    return { type: 'api-key', headerName: header, value };
  }

  // Auto-detect from spec security schemes
  for (const scheme of Object.values(spec.securitySchemes)) {
    if (
      scheme.type === 'http' &&
      scheme.scheme?.toLowerCase() === 'bearer'
    ) {
      const envToken = process.env.MCPIFY_BEARER_TOKEN;
      if (envToken) return { type: 'bearer', token: envToken };
    }
    if (scheme.type === 'apiKey' && scheme.name && scheme.in === 'header') {
      const envValue = process.env.MCPIFY_API_KEY_VALUE;
      if (envValue) {
        return { type: 'api-key', headerName: scheme.name, value: envValue };
      }
    }
  }

  return { type: 'none' };
}
