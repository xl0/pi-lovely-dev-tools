# Codebase

Pi package `@xl0/pi-lovely-dev-tools`.

## Structure

- `package.json`: npm/pi package manifest. Pi loads `./extensions`.
- `extensions/lovely-dev-tools/index.ts`: extension entrypoint.
- `tsconfig.json`, `biome.json`: strict TypeScript and Biome config matching adjacent pi packages.

## Current behavior

The extension registers `/run-tool`.

`/run-tool [tool_name]` waits for idle, lets the user pick a tool when no exact name is provided, prompts for JSON object arguments, prompts for a text tool response, asks whether the result is an error, then appends three synthetic chat-history messages:

1. user instruction to use the selected tool with the provided arguments
2. assistant message containing a `toolCall` block
3. `toolResult` message for that call

The command mutates the current `SessionManager` directly because extension command contexts only expose read-only session state publicly.
