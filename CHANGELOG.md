# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
