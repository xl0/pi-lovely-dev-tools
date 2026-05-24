# Codebase

Pi package `@xl0/pi-lovely-dev-tools`.

## Structure

- `package.json`: npm/pi package manifest. Pi loads `./extensions`.
- `extensions/lovely-dev-tools/index.ts`: extension entrypoint.
- `tsconfig.json`, `biome.json`: strict TypeScript and Biome config matching adjacent pi packages.

## Current behavior

The extension registers `/run-tool`.

`/run-tool [tool_name]` waits for idle, selects a tool (argument exact-matches by tool name, otherwise opens a selector), edits tool arguments in an inline TUI, executes the selected tool, then appends a single displayed custom message:

- `lovely-dev-tools.run-tool`: combines call info and result in one message with `toolName`, `toolArgs`, `toolCallId`, `result`, `isError`, `timestamp`.

The `context` hook removes this custom message type, so `/run-tool` history is visible in the TUI/session but never sent to the LLM.

## Argument editor

`editToolArgs()` maps the selected tool's TypeBox/JSON-schema-ish `parameters` into an inline editable TUI list:

- object properties become rows
- nested object properties are flattened into dotted ids and indented labels
- optional fields default to omitted; rows have an include checkbox `[ ]` / `[x]`
- required fields default to schema `default`, schema `const`, or `<omit>` if no default exists; their checkbox is always dim `[x]`
- enabled rows focus the value cell automatically; omitted optional rows focus the include checkbox
- Left/Right switches focus between the include checkbox and the value cell; moving left at the value start returns to the checkbox
- booleans and enums/literal unions cycle from the value cell
- strings/numbers/integers and complex values edit directly in the value cell with a single-line `Input` rendered without its normal `> ` prompt; string drafts are raw text, not JSON-quoted labels
- arrays/objects/unknown complex values are entered as JSON

`buildArgs()` reconstructs nested JSON from edited dotted paths, omitting fields whose checkbox is off. Scalar/JSON rows commit and validate when moving away or pressing Enter to run. Empty string and omit are distinct: an omitted value remains omitted; an included empty string commits as `""`. Escape backs out to tool selection; Escape there cancels the command.

## Tool execution and rendering

Tool execution uses command-context `ctx.getToolDefinition(name)` and calls `definition.execute(toolCallId, toolArgs, undefined, undefined, ctx)`. Thrown errors are captured into a text `AgentToolResult` and marked `isError: true`.

A single message renderer for `lovely-dev-tools.run-tool` shows the tool name and raw result output with `Box` + `Text`:

- errors use `toolErrorBg`
- success uses `toolSuccessBg`

`resultText()` renders text content blocks directly and non-text blocks as `[type]` placeholders.
