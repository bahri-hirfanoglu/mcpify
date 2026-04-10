export type OAuthFlowType = 'client_credentials' | 'refresh_token';

export interface OAuthOptions {
  flow: OAuthFlowType;
  tokenUrl: string;
  clientId?: string;
  clientSecret?: string;
  refreshToken?: string;
  scopes?: string[];
}

interface TokenResponse {
  access_token: string;
  token_type?: string;
  expires_in?: number;
  refresh_token?: string;
  scope?: string;
}

const EXPIRY_SKEW_MS = 60_000; // refresh a minute before expiry
const DEFAULT_LIFETIME_MS = 3600_000; // 1h fallback when server omits expires_in

export class TokenManager {
  private accessToken?: string;
  private expiresAt?: number;
  private refreshToken?: string;
  private pending?: Promise<void>;

  constructor(private readonly options: OAuthOptions) {
    this.refreshToken = options.refreshToken;
  }

  async getAccessToken(): Promise<string> {
    if (this.isFresh()) return this.accessToken!;

    // Deduplicate concurrent refreshes.
    if (!this.pending) {
      this.pending = this.fetchToken().finally(() => {
        this.pending = undefined;
      });
    }
    await this.pending;

    if (!this.accessToken) {
      throw new Error('OAuth2 token fetch returned no access_token');
    }
    return this.accessToken;
  }

  private isFresh(): boolean {
    if (!this.accessToken || !this.expiresAt) return false;
    return Date.now() < this.expiresAt - EXPIRY_SKEW_MS;
  }

  private async fetchToken(): Promise<void> {
    const body = new URLSearchParams();
    const headers: Record<string, string> = {
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
    };

    if (this.options.flow === 'client_credentials') {
      body.set('grant_type', 'client_credentials');
    } else {
      if (!this.refreshToken) {
        throw new Error(
          'OAuth2 refresh_token flow requires a refresh token',
        );
      }
      body.set('grant_type', 'refresh_token');
      body.set('refresh_token', this.refreshToken);
    }

    if (this.options.scopes?.length) {
      body.set('scope', this.options.scopes.join(' '));
    }

    if (this.options.clientId && this.options.clientSecret) {
      const creds = Buffer.from(
        `${this.options.clientId}:${this.options.clientSecret}`,
      ).toString('base64');
      headers['Authorization'] = `Basic ${creds}`;
    } else if (this.options.clientId) {
      body.set('client_id', this.options.clientId);
    }

    const response = await fetch(this.options.tokenUrl, {
      method: 'POST',
      headers,
      body: body.toString(),
    });

    if (!response.ok) {
      let errorText: string;
      try {
        errorText = await response.text();
      } catch {
        errorText = response.statusText;
      }
      throw new Error(
        `OAuth2 token fetch failed: ${response.status} ${errorText}`,
      );
    }

    const data = (await response.json()) as TokenResponse;
    if (!data.access_token) {
      throw new Error('OAuth2 token response missing access_token');
    }

    this.accessToken = data.access_token;
    const lifetime = data.expires_in != null ? data.expires_in * 1000 : DEFAULT_LIFETIME_MS;
    this.expiresAt = Date.now() + lifetime;
    if (data.refresh_token) {
      this.refreshToken = data.refresh_token;
    }
  }
}
