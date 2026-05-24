# Codebase

Pi package `@xl0/pi-lovely-dev-tools`.

## Structure

- `package.json`: npm/pi package manifest. Pi loads `./extensions`.
- `extensions/lovely-dev-tools/index.ts`: extension entrypoint.
- `tsconfig.json`, `biome.json`: strict TypeScript and Biome config matching adjacent pi packages.

## Current behavior

The extension registers `/run-tool`.

`/run-tool [tool_name]` waits for idle, lets the user pick a tool when no exact name is provided, edits tool arguments in a SettingsList-style TUI, executes the tool, then appends two displayed custom messages:

1. `lovely-dev-tools.run-tool.call`: rendered tool call with arguments
2. `lovely-dev-tools.run-tool.result`: rendered tool result or thrown error

The `context` hook filters both custom message types out, so run-tool history is visible in the TUI but not sent to the LLM.

Schema-to-TUI argument mapping supports object properties (including nested object properties shown with indentation), required/optional fields, string/number/integer/boolean scalars, `enum`/`const`/literal-union selection, defaults as initial values, and JSON input fallback for arrays/complex values.

Tool execution uses command-context `ctx.getToolDefinition(name)`, so it can execute the configured tool definition for built-in and extension tools.
