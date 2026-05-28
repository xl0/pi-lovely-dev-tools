# Codebase

Pi package `@xl0/pi-lovely-dev-tools`.

## Structure

- `package.json`: npm/pi package manifest. Pi loads `./extensions` and links `assets/demo.mp4` through `pi.video` using a raw GitHub URL. `assets/` is intentionally excluded from published npm files.
- `extensions/lovely-dev-tools/index.ts`: extension entrypoint. Registers `/tool` and `/show-sysprompt`.
- `assets/demo.mp4`: source demo video kept in repo, not shipped in npm package.
- `assets/demo.gif`: npm/GitHub-compatible README demo preview kept in repo, not shipped in npm package.
- `tsconfig.json`, `biome.json`: strict TypeScript and Biome config.

## `lovely-dev-tools`

### `/tool`

`/tool [tool_name] [flat args...]` waits for idle, selects a tool with a searchable inline selector when needed, edits args in an inline TUI when flat args are not supplied, executes the tool, then appends one displayed custom message. Tool selector search and `/tool <tab>` autocomplete match tool names only.

Flat args are assigned to top-level schema properties in schema order. Example: `/tool read file.txt 10 20`.

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
- `+` / `-` array item shortcuts work from array rows and their child rows
- booleans and enums/literal unions cycle with Space from the value cell
- scalar and unstructured object/array leaves edit inline with a single-line `Input`
- string drafts are JSON-quoted while editing
- tool description and selected-row schema/help are shown in a fixed-height top panel

The editor mutates a nested args object directly from schema paths. Omitted fields/groups are absent from the final args. Scalar/JSON rows commit and validate when moving away or pressing Enter. Empty string and omitted are distinct.

Escape returns to tool selection/cancel. Enter runs.

## Tool execution and rendering

Tool execution uses the selected `ToolInfo` from `pi.getAllTools()` and calls `tool.execute(toolCallId, toolArgs, undefined, undefined, ctx)`. Thrown errors become text `AgentToolResult`s with `isError: true`.

While running, a `tool-loading` widget shows the pending call. On completion, a `lovely-dev-tools.run-tool` renderer shows the completed call and raw result output:

- errors use `toolErrorBg`
- success uses `toolSuccessBg`

`resultText()` renders text blocks directly and non-text blocks as placeholders. Image result blocks currently render both a text placeholder and, when the terminal supports images, an inline image. Non-PNG image blocks (top-level or `source`-shaped) are converted with Pi's `convertToPng()` before storing results for Kitty-compatible terminals. Conversion failures turn the displayed `/tool` result into an explicit error message.

### `/show-sysprompt`

`/show-sysprompt` waits for idle, then emits two displayed custom messages:

- rendered system prompt from `ctx.getSystemPrompt()`
- active tool schemas from `pi.getAllTools()` filtered by `pi.getActiveTools()`

Both messages use collapsible custom renderers, are filtered out of LLM context, and are skipped in session tree preparation. Tool schema formatting shows each active tool, its top-level parameters, required/optional status, inferred schema type, and parameter description when present.
