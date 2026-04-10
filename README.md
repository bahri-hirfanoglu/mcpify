<p align="center">
  <img src="docs/logo.png" width="120" alt="mcpify logo">
</p>

<h1 align="center">mcpify</h1>

<p align="center">
  <strong>OpenAPI to MCP in seconds</strong>
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@bahridev/mcpify"><img src="https://img.shields.io/npm/v/@bahridev/mcpify?style=flat-square&color=6366f1" alt="npm version"></a>
  <a href="https://github.com/bahri-hirfanoglu/mcpify/blob/master/LICENSE"><img src="https://img.shields.io/npm/l/@bahridev/mcpify?style=flat-square&color=8b5cf6" alt="license"></a>
  <a href="https://www.npmjs.com/package/@bahridev/mcpify"><img src="https://img.shields.io/npm/dm/@bahridev/mcpify?style=flat-square&color=a78bfa" alt="downloads"></a>
  <a href="https://github.com/bahri-hirfanoglu/mcpify"><img src="https://img.shields.io/github/stars/bahri-hirfanoglu/mcpify?style=flat-square&color=c4b5fd" alt="stars"></a>
</p>

<p align="center">
  Generate an MCP server from any OpenAPI specification.<br>
  Let AI assistants interact with your REST APIs instantly.
</p>

---

## Install

```bash
npm install -g @bahridev/mcpify
```

## Quick Start

```bash
# Start an MCP server from a local spec
mcpify ./openapi.yaml

# From a URL
mcpify https://petstore3.swagger.io/api/v3/openapi.json

# With authentication
mcpify ./api.yaml --bearer-token $API_TOKEN

# HTTP transport (remote access)
mcpify ./api.yaml --transport http --port 3100

# Preview tools without starting server
mcpify ./api.yaml --dry-run

# Watch for spec changes
mcpify ./api.yaml --watch

# Interactive config setup
mcpify init

# Validate a spec for MCP compatibility
mcpify validate ./api.yaml

# Inspect a single tool
mcpify inspect ./api.yaml listPets

# Add to Claude Desktop config automatically
mcpify install ./api.yaml --name my-api --bearer-token $API_TOKEN
```

## Usage

```
mcpify <spec> [options]

Arguments:
  spec                     OpenAPI spec file path or URL

Options:
  --spec <source>              Spec source (alternative to positional arg)
  --transport <type>           stdio (default) | http
  --port <number>              HTTP port (default: 3100)
  --base-url <url>             API base URL override
  --bearer-token <token>       Bearer token
  --api-key-header <name>      API key header name
  --api-key-value <value>      API key value
  --oauth-flow <flow>          OAuth2 flow (client_credentials | refresh_token)
  --oauth-token-url <url>      OAuth2 token endpoint
  --oauth-client-id <id>       OAuth2 client ID
  --oauth-client-secret <s>    OAuth2 client secret
  --oauth-refresh-token <t>    OAuth2 refresh token
  --oauth-scopes <scopes>      OAuth2 scopes (comma-separated)
  --include <patterns>         Include operations (glob, comma-separated)
  --exclude <patterns>         Exclude operations (glob, comma-separated)
  --tags <tags>                Only include these tags (comma-separated)
  --naming <style>             Tool naming: camelCase | snake_case | original
  --prefix <prefix>            Prefix for all tool names
  --header <key:value>         Custom headers (repeatable)
  --max-response-size <kb>     Max response size in KB (default: 50)
  --dry-run                    List tools without starting server
  --watch                      Watch spec file and reload on changes
  --verbose                    Verbose HTTP logging to stderr
  -V, --version                Output version
  -h, --help                   Show help

Commands:
  init                         Interactively create a .mcpifyrc.json
  validate <spec>              Report MCP compatibility of a spec
  inspect <spec> <tool>        Show full schema and example call for a tool
  install <spec>               Add entry to claude_desktop_config.json
```

## Supported Specs

- **OpenAPI 3.0.x** and **3.1.x**
- **Swagger 2.0**
- YAML and JSON formats
- Local files and remote URLs

Version is auto-detected — just point mcpify at any spec.

## Claude Desktop Configuration

The fastest way: let mcpify edit the config for you.

```bash
mcpify install ./path/to/openapi.yaml --name my-api --bearer-token $API_TOKEN
```

This writes (or updates) an `mcpServers.my-api` entry in the
platform-specific config file:

| Platform | Path |
|----------|------|
| Windows  | `%APPDATA%\Claude\claude_desktop_config.json` |
| macOS    | `~/Library/Application Support/Claude/claude_desktop_config.json` |
| Linux    | `$XDG_CONFIG_HOME/Claude/claude_desktop_config.json` or `~/.config/Claude/claude_desktop_config.json` |

Bearer tokens are written to `entry.env` (not to the CLI args) so they
don't show up in process listings. Pass `--force` to overwrite an
existing entry, `--config <path>` to target a different file, and
`--transport http --port 3100` to wire up the HTTP transport.

Or edit the file manually:

```json
{
  "mcpServers": {
    "my-api": {
      "command": "mcpify",
      "args": ["./path/to/openapi.yaml"],
      "env": {
        "MCPIFY_BEARER_TOKEN": "your-token"
      }
    }
  }
}
```

## HTTP Transport

Run as a remote MCP server accessible over HTTP:

```bash
mcpify ./api.yaml --transport http --port 3100
```

This exposes:
- `POST /mcp` — MCP JSON-RPC endpoint (Streamable HTTP)
- `GET /mcp` — SSE stream for server-initiated messages
- `DELETE /mcp` — End an MCP session
- `GET /health` — Health check endpoint

Each client gets an isolated session with its own MCP server instance. Sessions are tracked via the `mcp-session-id` header.

## OAuth2

mcpify supports OAuth2 **client credentials** and **refresh token**
flows. When either the `oauth2` security scheme in your spec exposes a
`clientCredentials.tokenUrl` / `authorizationCode.refreshUrl` and the
corresponding credentials are present in the environment, mcpify will
automatically fetch tokens and refresh them before expiry.

### Client credentials (machine-to-machine)

```bash
mcpify ./api.yaml \
  --oauth-flow client_credentials \
  --oauth-token-url https://auth.example.com/token \
  --oauth-client-id $CLIENT_ID \
  --oauth-client-secret $CLIENT_SECRET \
  --oauth-scopes "read,write"
```

Or equivalently, let mcpify discover `tokenUrl` from the spec and only
supply the credentials via env vars:

```bash
export MCPIFY_OAUTH_CLIENT_ID=...
export MCPIFY_OAUTH_CLIENT_SECRET=...
mcpify ./api.yaml
```

### Refresh token

```bash
mcpify ./api.yaml \
  --oauth-flow refresh_token \
  --oauth-token-url https://auth.example.com/token \
  --oauth-client-id $CLIENT_ID \
  --oauth-refresh-token $REFRESH_TOKEN
```

The refresh token is rotated automatically when the server returns a
new one in the token response.

### `.mcpifyrc.json`

```json
{
  "spec": "./api.yaml",
  "oauth": {
    "flow": "client_credentials",
    "tokenUrl": "https://auth.example.com/token",
    "clientId": "my-client",
    "clientSecret": "shhh",
    "scopes": ["read", "write"]
  }
}
```

### Authorization code / OpenID Connect

Full interactive browser-based authorization is out of scope for now.
Use your IdP's tooling (or a one-time `curl` exchange) to obtain a
refresh token, then pass it with `--oauth-refresh-token`. If your spec
uses an `openIdConnect` scheme, provide `--oauth-token-url` explicitly
because mcpify does not auto-discover OIDC configuration.

## `mcpify init`

Generates a `.mcpifyrc.json` interactively:

```bash
$ mcpify init
OpenAPI spec source (file path or URL): ./openapi.yaml
Transport (stdio | http) (stdio): http
HTTP port (3100):
Override base URL (empty to skip):
Auth type (none | bearer | api-key | oauth2) (none): oauth2
OAuth2 flow (client_credentials | refresh_token) (client_credentials):
...
✓ Wrote /path/to/.mcpifyrc.json
```

Pass `--force` to overwrite an existing config without confirmation.

## `mcpify validate`

Reports which parts of a spec mcpify can handle, with issues grouped
by severity:

```bash
$ mcpify validate ./api.yaml

OAuth API v1.0.0
Base URL: https://api.example.com

Operations: 12
Tools:      12

Security schemes:
  ✓ oauth (oauth2 (clientCredentials))
  ⚠ oidc (openIdConnect)

Issues:
  ⚠ security scheme "oidc" is OpenID Connect — mcpify does not
    auto-discover the tokenUrl. Provide --oauth-token-url manually

⚠ PASS with warnings — 1 warning(s)
```

Exits with code 1 when errors are present. Use this in CI to guard
against spec regressions.

## `mcpify inspect`

Shows the full tool metadata, a placeholder example argument object,
and an equivalent cURL invocation:

```bash
$ mcpify inspect ./api.yaml getPet

getPet
──────
GET /pets/{petId}
Base URL: https://petstore.example.com/v1
Tags: pets
Hints: read-only

Description:
  Get a pet by ID

  Returns: {id, name, tag}

Input schema:
  { ... }

Example arguments:
  { "petId": "<string>" }

cURL:
  curl -X GET 'https://petstore.example.com/v1/pets/%3Cstring%3E' \
    -H 'Accept: application/json'
```

Respects `--naming`, `--prefix`, `--include`, `--exclude`, `--tags`,
and `--base-url`, so tool name resolution matches the configuration
you use at runtime.

## Docker

```bash
# Build
docker build -t mcpify .

# Run over HTTP
docker run --rm -p 3100:3100 \
  -v "$PWD/openapi.yaml:/spec/openapi.yaml:ro" \
  mcpify /spec/openapi.yaml --transport http --port 3100
```

Published images are available at `ghcr.io/bahri-hirfanoglu/mcpify:<version>`.

## GitHub Action

Use the composite action to validate specs or spin up an MCP server in
a workflow:

```yaml
- uses: bahri-hirfanoglu/mcpify@v1
  with:
    spec: ./openapi.yaml
    command: validate
```

Supported commands: `validate`, `dry-run`, `inspect`, `serve`. Pass
additional flags via `extra-args`.

## Config File

Create a `.mcpifyrc.json` in your project root to avoid repeating CLI flags:

```json
{
  "spec": "./openapi.yaml",
  "transport": "stdio",
  "bearerToken": "sk-...",
  "include": ["get*", "list*"],
  "exclude": ["delete*"],
  "naming": "snake_case",
  "prefix": "myapi_",
  "headers": {
    "X-Custom-Header": "value",
    "X-Api-Version": "2024-01"
  },
  "verbose": true
}
```

Supported file names: `.mcpifyrc.json`, `.mcpifyrc`, `mcpify.config.json`

CLI flags always override config file values.

## Custom Tool Naming

```bash
# Convert operationIds to snake_case
mcpify api.yaml --naming snake_case

# Add a prefix to all tool names
mcpify api.yaml --prefix myapi_

# Combine both
mcpify api.yaml --naming snake_case --prefix myapi_
# listAllPets → myapi_list_all_pets
```

## Custom Headers

Send custom HTTP headers with every API request:

```bash
# Single header
mcpify api.yaml --header "Authorization: Bearer sk-..."

# Multiple headers
mcpify api.yaml --header "Authorization: Bearer sk-..." --header "X-Api-Version: 2024-01"
```

Also configurable via `.mcpifyrc.json` (`headers` field).

## Filtering Operations

```bash
# Only include specific operations
mcpify api.yaml --include "get*,list*"

# Exclude destructive operations
mcpify api.yaml --exclude "delete*,remove*"

# Filter by tags
mcpify api.yaml --tags "users,pets"
```

## Response Schema Hints

Tool descriptions automatically include response structure information extracted from the spec:

```
listPets — List all pets

Returns: array of {id, name, tag}
```

This helps AI assistants understand what the API returns before calling a tool.

## Key Sanitization

mcpify automatically sanitizes JSON Schema property keys that contain special characters (dots, brackets, hyphens, etc.) to ensure compatibility with all MCP clients. Original keys are restored when making API requests, so the target API always receives the correct parameter names.

```
X-Request-ID  →  x_request_id  (in tool schema)
filter[name]  →  filter_name_  (in tool schema)
```

This is fully transparent — no configuration needed.

## Verbose Logging

```bash
mcpify api.yaml --verbose
```

Logs HTTP requests and responses to stderr:

```
→ GET https://api.example.com/pets?limit=10
← ✓ 200 45ms 1.2KB
→ POST https://api.example.com/pets
← ✗ 401 12ms 156B
```

## Environment Variables

| Variable | Description |
|----------|-------------|
| `MCPIFY_BEARER_TOKEN` | Bearer token for authentication |
| `MCPIFY_API_KEY_HEADER` | API key header name |
| `MCPIFY_API_KEY_VALUE` | API key value |
| `MCPIFY_OAUTH_CLIENT_ID` | OAuth2 client ID |
| `MCPIFY_OAUTH_CLIENT_SECRET` | OAuth2 client secret |
| `MCPIFY_OAUTH_REFRESH_TOKEN` | OAuth2 refresh token |

## Programmatic API

```typescript
import { parseSpec, generateTools, startServer } from '@bahridev/mcpify';

const spec = await parseSpec('./openapi.yaml');
const tools = generateTools(spec.operations);

await startServer({
  spec,
  tools,
  operations: spec.operations,
  baseUrl: spec.defaultServerUrl,
  auth: { type: 'none' },
  transport: 'stdio',
  port: 3100,
  maxResponseSize: 50 * 1024,
});
```

## How It Works

1. Parses and dereferences the OpenAPI/Swagger spec
2. Converts each operation to an MCP tool with JSON Schema input
3. Adds response schema hints to tool descriptions
4. Starts an MCP server (stdio or HTTP transport)
5. When a tool is called, builds and executes the corresponding HTTP request
6. Returns the API response as MCP tool output

## License

MIT
