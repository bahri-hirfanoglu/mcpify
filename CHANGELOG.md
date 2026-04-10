# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.2.0] - 2026-04-10

### Added
- **OAuth2 support** — client credentials and refresh token flows with
  automatic token refresh, concurrent request deduplication, and expiry
  skew. Auto-detected from spec `securitySchemes` when environment
  variables are present.
  - New CLI flags: `--oauth-flow`, `--oauth-token-url`, `--oauth-client-id`,
    `--oauth-client-secret`, `--oauth-refresh-token`, `--oauth-scopes`
  - New env vars: `MCPIFY_OAUTH_CLIENT_ID`, `MCPIFY_OAUTH_CLIENT_SECRET`,
    `MCPIFY_OAUTH_REFRESH_TOKEN`
  - Parser now extracts OAuth2 flow definitions and `openIdConnectUrl`
  - Exported `TokenManager` for programmatic use
- **`mcpify init`** — interactive `.mcpifyrc.json` generator walking
  through spec, transport, auth, filters, naming, and verbose options
- **`mcpify validate`** — compatibility report for a spec showing
  operation/tool counts, detected security schemes, and issues grouped
  by severity (errors fail with exit code 1)
- **`mcpify inspect <spec> <tool>`** — shows a tool's full description,
  input schema, placeholder example, and equivalent cURL invocation.
  Suggests similar names when the tool is not found
- **`mcpify install`** — writes / updates a `mcpServers` entry in the
  platform-specific `claude_desktop_config.json`. Bearer tokens are
  stored in `entry.env` instead of CLI args. Preserves unrelated
  keys and existing server entries
- **Docker image** — multi-stage Alpine Dockerfile, dev deps pruned for
  runtime, `EXPOSE 3100`, and `node dist/cli.js` entrypoint
- **GitHub Action** — composite action supporting
  `validate` / `dry-run` / `inspect` / `serve` commands
- **CI and release workflows** — `.github/workflows/ci.yml` tests on
  Node 18/20/22 and builds the Docker image; `.github/workflows/release.yml`
  publishes to npm and GHCR on `v*.*.*` tag push

### Fixed
- URL joining preserved base path segments when the operation path began
  with `/`. Previously `https://api.example.com/v1` + `/pets` became
  `https://api.example.com/pets`; it now correctly becomes
  `https://api.example.com/v1/pets`. A regression test guards against
  re-introduction.

### Changed
- `applyAuth` is now async to accommodate OAuth2 token fetching. Direct
  callers must `await` the result.

## [1.1.1] - 2026-04-09

### Added
- Automatic JSON Schema key sanitization for MCP client compatibility
  (dots, brackets, hyphens in parameter names)
- Custom headers via `--header "Key: Value"` (repeatable) and config
  file `headers` field
- Per-session HTTP transport management — each client gets its own
  isolated transport and server instance

## [1.1.0] - 2026-04-08

### Added
- Streamable HTTP transport (`--transport http`) with `/mcp` and `/health` endpoints
- Swagger 2.0 support with automatic version detection
- Config file support (`.mcpifyrc.json`, `.mcpifyrc`, `mcpify.config.json`)
- Dry run mode (`--dry-run`) to preview tools without starting server
- Watch mode (`--watch`) for auto-reload on spec file changes
- Verbose HTTP logging (`--verbose`) with method, URL, status, duration, and size
- Custom tool naming (`--naming camelCase|snake_case`) and prefix (`--prefix`)
- Response schema hints in tool descriptions for better AI understanding

## [1.0.0] - 2026-04-08

### Added
- OpenAPI 3.x spec parsing with full dereferencing
- Automatic operationId generation for unnamed operations
- MCP tool generation with JSON Schema input validation
- Tool filtering by glob patterns (include/exclude) and tags
- Bearer token and API key authentication
- Environment variable support for auth credentials
- Auto-detection of auth type from spec security schemes
- HTTP client with path/query substitution, timeout, and response handling
- MCP server using low-level Server API with stdio transport
- CLI with all configuration options
- Programmatic API for library usage
- Tool annotations (readOnlyHint, destructiveHint)
- Response truncation for large API responses
