# Contributing to mcpify

Thanks for your interest in contributing! Here's how to get started.

## Development Setup

```bash
git clone https://github.com/bahri-hirfanoglu/mcpify.git
cd mcpify
npm install
npm run build
npm test
```

## Project Structure

```
src/
  cli.ts              # CLI entry point
  index.ts            # Programmatic API exports
  types.ts            # TypeScript type definitions
  parser/openapi.ts   # OpenAPI spec parser
  generator/tools.ts  # MCP tool generator
  auth/handler.ts     # Authentication handler
  runtime/
    http-client.ts    # HTTP request executor
    server.ts         # MCP server setup
tests/
  fixtures/           # OpenAPI spec fixtures
  *.test.ts           # Test files
```

## Development Workflow

1. Fork the repository
2. Create a feature branch: `git checkout -b feature/my-feature`
3. Make your changes
4. Run tests: `npm test`
5. Run build: `npm run build`
6. Commit your changes with a descriptive message
7. Push and open a pull request

## Running Tests

```bash
# Run all tests
npm test

# Watch mode
npm run test:watch
```

## Code Style

- TypeScript strict mode
- ES2022 target with NodeNext modules
- All diagnostic output goes to stderr (stdout is reserved for stdio transport)
- Single responsibility per file
- Error handling: tool calls never throw, always return MCP result
- JSON Schema is used as-is, never converted to Zod

## Reporting Issues

- Use GitHub Issues
- Include your Node.js version, OS, and the OpenAPI spec that caused the issue
- Minimal reproduction steps are appreciated

## License

By contributing, you agree that your contributions will be licensed under the MIT License.
