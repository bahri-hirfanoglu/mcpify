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
```

## Usage

```
mcpify <spec> [options]

Arguments:
  spec                     OpenAPI spec file path or URL

Options:
  --spec <source>          Spec source (alternative to positional arg)
  --transport <type>       stdio (default) | http
  --port <number>          HTTP port (default: 3100)
  --base-url <url>         API base URL override
  --bearer-token <token>   Bearer token
  --api-key-header <name>  API key header name
  --api-key-value <value>  API key value
  --include <patterns>     Include operations (glob, comma-separated)
  --exclude <patterns>     Exclude operations (glob, comma-separated)
  --tags <tags>            Only include these tags (comma-separated)
  --naming <style>         Tool naming: camelCase | snake_case | original
  --prefix <prefix>        Prefix for all tool names
  --max-response-size <kb> Max response size in KB (default: 50)
  --dry-run                List tools without starting server
  --watch                  Watch spec file and reload on changes
  --verbose                Verbose HTTP logging to stderr
  -V, --version            Output version
  -h, --help               Show help
```

## Supported Specs

- **OpenAPI 3.0.x** and **3.1.x**
- **Swagger 2.0**
- YAML and JSON formats
- Local files and remote URLs

Version is auto-detected — just point mcpify at any spec.

## Claude Desktop Configuration

Add to your `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "my-api": {
      "command": "mcpify",
      "args": ["./path/to/openapi.yaml", "--bearer-token", "your-token"]
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
- `GET /health` — Health check endpoint

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
