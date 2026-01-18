# @prb/effect-next

## References

- **Project overview**: @README.md
- **Dependencies**: @package.json
- **Commands**: @justfile and @../recipes.just

## Aliases

`just b` (build), `just t` (test), `just tui` (test-ui)

## Server/Client Boundaries

- `"use client"` directive for client-only files (hooks, browser APIs)
- `import "server-only"` for server-only files
- Place directives before imports

## Comments

- Use `/** */` (JSDoc) for public APIs with `@param`, `@returns`, `@example`
- Use `//` for inline logic explanations
- Use `@internal` for internal APIs
