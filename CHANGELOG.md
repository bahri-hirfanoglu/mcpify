# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
