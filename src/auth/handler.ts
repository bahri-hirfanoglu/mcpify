import type { AuthConfig, ParsedSpec } from '../types.js';
import { TokenManager, type OAuthOptions, type OAuthFlowType } from './oauth.js';

export async function applyAuth(
  headers: Record<string, string>,
  auth: AuthConfig,
): Promise<void> {
  switch (auth.type) {
    case 'bearer':
      headers['Authorization'] = `Bearer ${auth.token}`;
      break;
    case 'api-key':
      headers[auth.headerName] = auth.value;
      break;
    case 'oauth2': {
      const token = await auth.tokenManager.getAccessToken();
      headers['Authorization'] = `Bearer ${token}`;
      break;
    }
    case 'none':
      break;
  }
}

export interface AuthOptions {
  bearerToken?: string;
  apiKeyHeader?: string;
  apiKeyValue?: string;
  oauth?: Partial<OAuthOptions>;
}

export function resolveAuth(
  options: AuthOptions,
  spec: ParsedSpec,
): AuthConfig {
  const token = options.bearerToken ?? process.env.MCPIFY_BEARER_TOKEN;
  if (token) {
    return { type: 'bearer', token };
  }

  const header = options.apiKeyHeader ?? process.env.MCPIFY_API_KEY_HEADER;
  const value = options.apiKeyValue ?? process.env.MCPIFY_API_KEY_VALUE;
  if (header && value) {
    return { type: 'api-key', headerName: header, value };
  }

  const oauth = resolveOAuth(options.oauth, spec);
  if (oauth) {
    return { type: 'oauth2', tokenManager: new TokenManager(oauth) };
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

function resolveOAuth(
  explicit: Partial<OAuthOptions> | undefined,
  spec: ParsedSpec,
): OAuthOptions | undefined {
  const envClientId = process.env.MCPIFY_OAUTH_CLIENT_ID;
  const envClientSecret = process.env.MCPIFY_OAUTH_CLIENT_SECRET;
  const envRefreshToken = process.env.MCPIFY_OAUTH_REFRESH_TOKEN;

  const clientId = explicit?.clientId ?? envClientId;
  const clientSecret = explicit?.clientSecret ?? envClientSecret;
  const refreshToken = explicit?.refreshToken ?? envRefreshToken;

  // Explicit flow + tokenUrl provided — trust the caller.
  if (explicit?.flow && explicit.tokenUrl) {
    return {
      flow: explicit.flow,
      tokenUrl: explicit.tokenUrl,
      clientId,
      clientSecret,
      refreshToken,
      scopes: explicit.scopes,
    };
  }

  // Try to infer flow + tokenUrl from spec's oauth2 scheme.
  const specFlow = findSpecOAuthFlow(spec);
  if (!specFlow) return undefined;

  const flow: OAuthFlowType | undefined =
    explicit?.flow ?? specFlow.defaultFlow;
  const tokenUrl = explicit?.tokenUrl ?? specFlow.tokenUrl;

  if (!flow || !tokenUrl) return undefined;

  // For client_credentials we need id+secret; for refresh we need a refresh token.
  if (flow === 'client_credentials' && (!clientId || !clientSecret)) {
    return undefined;
  }
  if (flow === 'refresh_token' && !refreshToken) {
    return undefined;
  }

  return {
    flow,
    tokenUrl,
    clientId,
    clientSecret,
    refreshToken,
    scopes: explicit?.scopes ?? specFlow.scopes,
  };
}

interface SpecFlowHit {
  defaultFlow: OAuthFlowType;
  tokenUrl: string;
  scopes: string[];
}

function findSpecOAuthFlow(spec: ParsedSpec): SpecFlowHit | undefined {
  for (const scheme of Object.values(spec.securitySchemes)) {
    if (scheme.type !== 'oauth2' || !scheme.flows) continue;

    const cc = scheme.flows.clientCredentials;
    if (cc?.tokenUrl) {
      return {
        defaultFlow: 'client_credentials',
        tokenUrl: cc.tokenUrl,
        scopes: Object.keys(cc.scopes ?? {}),
      };
    }
    const ac = scheme.flows.authorizationCode;
    if (ac?.tokenUrl || ac?.refreshUrl) {
      return {
        defaultFlow: 'refresh_token',
        tokenUrl: ac.refreshUrl ?? ac.tokenUrl!,
        scopes: Object.keys(ac.scopes ?? {}),
      };
    }
  }
  return undefined;
}
