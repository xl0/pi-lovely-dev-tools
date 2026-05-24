# Codebase

Pi package `@xl0/pi-lovely-dev-tools`.

## Structure

- `package.json`: npm/pi package manifest. Pi loads `./extensions`.
- `extensions/lovely-dev-tools/index.ts`: extension entrypoint.
- `tsconfig.json`, `biome.json`: strict TypeScript and Biome config.

## `/run-tool`

`/run-tool [tool_name]` waits for idle, selects a tool with a searchable inline selector, edits args in an inline TUI, executes the tool, then appends one displayed custom message.

Custom message type: `lovely-dev-tools.run-tool` with `toolName`, `toolArgs`, `toolCallId`, `result`, `isError`, `timestamp`.

The `context` hook filters these custom messages out of LLM context while keeping them visible in the TUI/session.

## Argument editor

`editToolArgs()` renders a schema-driven argument editor.

- object properties render as indented group rows; included objects expose child rows
- optional fields/groups default to omitted and have `[ ]` / `[x]` include controls
- required fields/groups default from schema default/const/enum or simple type defaults
- arrays render as group rows with item counts
- `+` on an array inserts at index 0; `+` on an item inserts after it; `-` removes items
- array object items render as `[n]` rows with indented property rows
- booleans and enums/literal unions cycle with Space from the value cell
- scalar and unstructured object/array leaves edit inline with a single-line `Input`
- string drafts are JSON-quoted while editing
- tool description and selected-row schema/help are shown in a fixed-height top panel

The editor mutates a nested args object directly from schema paths. Omitted fields/groups are absent from the final args. Scalar/JSON rows commit and validate when moving away or pressing Enter. Empty string and omitted are distinct.

Escape returns to tool selection/cancel. Enter runs.

## Tool execution and rendering

Tool execution uses `ctx.getToolDefinition(name)` and calls `definition.execute(toolCallId, toolArgs, undefined, undefined, ctx)`. Thrown errors become text `AgentToolResult`s with `isError: true`.

While running, a `tool-loading` widget shows the pending call. On completion, a `lovely-dev-tools.run-tool` renderer shows the completed call and raw result output:

- errors use `toolErrorBg`
- success uses `toolSuccessBg`

`resultText()` renders text blocks directly and non-text blocks as `[type]` placeholders.
