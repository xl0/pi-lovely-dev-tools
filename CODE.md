# Codebase

Pi package `@xl0/pi-lovely-dev-tools`.

## Structure

- `package.json`: npm/pi package manifest. Pi loads `./extensions`.
- `extensions/lovely-dev-tools/index.ts`: extension entrypoint.
- `tsconfig.json`, `biome.json`: strict TypeScript and Biome config matching adjacent pi packages.

## Current behavior

The extension registers `/run-tool`.

`/run-tool [tool_name]` waits for idle, selects a tool (argument exact-matches by tool name, otherwise opens a selector), edits tool arguments in a SettingsList-style TUI, executes the selected tool, then appends two displayed custom messages:

1. `lovely-dev-tools.run-tool.call`: rendered call fixture with `toolName`, `toolArgs`, `toolCallId`, `timestamp`.
2. `lovely-dev-tools.run-tool.result`: rendered execution result with `toolName`, `toolCallId`, `result`, `isError`, `timestamp`.

The `context` hook removes both custom message types, so `/run-tool` history is visible in the TUI/session but never sent to the LLM.

## Argument editor

`editToolArgs()` maps the selected tool's TypeBox/JSON-schema-ish `parameters` into editable `SettingItem`s:

- object properties become settings rows
- nested object properties are flattened into dotted ids and indented labels
- optional fields default to `<omit>`
- required fields default to schema `default`, schema `const`, or `<omit>` if no default exists
- booleans and enums/literal unions cycle inline
- strings/numbers/integers and complex values open an `ExtensionInputComponent`
- arrays/objects/unknown complex values are entered as JSON

`buildArgs()` reconstructs nested JSON from edited dotted paths, omitting fields still set to `<omit>`.

## Tool execution and rendering

Tool execution uses command-context `ctx.getToolDefinition(name)` and calls `definition.execute(toolCallId, toolArgs, undefined, undefined, ctx)`. Thrown errors are captured into a text `AgentToolResult` and marked `isError: true`.

Custom renderers use simple `Box` + `Text` output:

- call messages use `customMessageBg`
- successful results use `toolSuccessBg`
- error results use `toolErrorBg`

`resultText()` renders text content blocks directly and non-text blocks as `[type]` placeholders.
