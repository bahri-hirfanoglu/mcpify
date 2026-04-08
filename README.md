# mcpify

Generate an MCP (Model Context Protocol) server from any OpenAPI specification. Lets AI assistants like Claude interact with REST APIs directly.

## Install

```bash
npm install -g mcpify
```

## Quick Start

```bash
# Start an MCP server from a local spec
mcpify ./openapi.yaml

# From a URL
mcpify https://petstore3.swagger.io/api/v3/openapi.json

# With authentication
mcpify ./api.yaml --bearer-token $API_TOKEN
```

## Usage

```
mcpify <spec> [options]

Arguments:
  spec                     OpenAPI spec file path or URL

Options:
  --transport <type>       stdio (default) | http
  --port <number>          HTTP port (default: 3100)
  --base-url <url>         API base URL override
  --bearer-token <token>   Bearer token
  --api-key-header <name>  API key header name
  --api-key-value <value>  API key value
  --include <patterns>     Include operations (glob, comma-separated)
  --exclude <patterns>     Exclude operations (glob, comma-separated)
  --tags <tags>            Only include these tags (comma-separated)
  --max-response-size <kb> Max response size in KB (default: 50)
  --verbose                Verbose logging to stderr
  -V, --version            Output version
  -h, --help               Show help
```

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

## Filtering Operations

```bash
# Only include specific operations
mcpify api.yaml --include "get*,list*"

# Exclude destructive operations
mcpify api.yaml --exclude "delete*,remove*"

# Filter by tags
mcpify api.yaml --tags "users,pets"
```

## Environment Variables

| Variable | Description |
|----------|-------------|
| `MCPIFY_BEARER_TOKEN` | Bearer token for authentication |
| `MCPIFY_API_KEY_HEADER` | API key header name |
| `MCPIFY_API_KEY_VALUE` | API key value |

## Programmatic API

```typescript
import { parseSpec, generateTools, startServer } from 'mcpify';

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

1. Parses and dereferences the OpenAPI spec
2. Converts each operation to an MCP tool with JSON Schema input
3. Starts an MCP server (stdio or HTTP transport)
4. When a tool is called, builds and executes the corresponding HTTP request
5. Returns the API response as MCP tool output

## License

MIT
