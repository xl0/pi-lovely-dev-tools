# Codebase

Pi package `@xl0/pi-lovely-dev-tools`.

## Structure

- `package.json`: npm/pi package manifest. Pi loads `./extensions` and links `assets/demo.mp4` through `pi.video` using a raw GitHub URL. `assets/` is intentionally excluded from published npm files. Peer/dev deps include `@earendil-works/pi-ai` for direct `validateToolArguments()` imports.
- `CONTEXT.md`: domain language for Manual Tool Runs, the Manual Tool Runner, Agent Tool Calls, Nested Execution Sessions, and Bridged Tool UI.
- `docs/adr/0001-manual-tool-runner-stays-extension.md`: decision to keep `/tool` as an extension and use a nested SDK session for execution.
- `extensions/lovely-dev-tools/index.ts`: small extension entrypoint. Registers command modules and hidden-message filters.
- `extensions/lovely-dev-tools/messages.ts`: custom message type constants, hidden message set, `/tool` message details guard.
- `extensions/lovely-dev-tools/schema.ts`: shared JSON-schema helpers for defaults, enum/type display, value coercion, argument formatting, and text wrapping.
- `extensions/lovely-dev-tools/arg-editor.ts`: schema-driven interactive `/tool` argument editor. Depends only on extension UI plus tool name/description/schema metadata, not the full command context.
- `extensions/lovely-dev-tools/tool-command.ts`: `/tool` selector, flat arg parsing, focused pending run component, result/image rendering.
- `extensions/lovely-dev-tools/tool-backend.ts`: single-use Nested Execution Session backend for Manual Tool Runs.
- `extensions/lovely-dev-tools/show-sysprompt.ts`: `/show-sysprompt` command and collapsible renderers.
- `assets/demo.mp4`: source demo video kept in repo, not shipped in npm package.
- `assets/demo.gif`: npm/GitHub-compatible README demo preview kept in repo, not shipped in npm package.
- `tsconfig.json`, `biome.json`: strict TypeScript and Biome config.

## `lovely-dev-tools`

### `/tool`

`/tool [tool_name] [flat args...]` waits for idle, selects a tool with a searchable inline selector when needed, edits args in an inline TUI when flat args are not supplied, executes the tool, then appends one displayed custom message. Tool selector search and `/tool <tab>` autocomplete match tool names only. Unknown tool names pre-seed the selector search. Inactive tools are visible and runnable manually; active/inactive only marks LLM availability.

Flat args are assigned to top-level schema properties in schema order by a schema-only parser; shell-style quotes preserve spaces and empty strings. Example: `/tool read file.txt 10 20`.

Custom message type: `lovely-dev-tools.run-tool` with `toolName`, `toolArgs`, `toolCallId`, `result`, `isError`, `timestamp`, and optional `imageFallbacks`.

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
- scalar leaves edit inline with a single-line `Input`; structured objects/arrays render as group rows
- string drafts edit as raw text with decorative quotes around the input cell
- tool description and selected-row schema/help are shown in a fixed-height top panel

The editor mutates a nested args object directly from schema paths. Omitted fields/groups are absent from the final args. Scalar/JSON rows commit and validate when moving away or pressing Enter. Empty string and omitted are distinct.

Escape returns to tool selection/cancel. Enter runs.

## Tool execution and rendering

Tool execution creates a single-use nested SDK session with `createAgentSessionServices()` / `createAgentSessionFromServices()`, `SessionManager.inMemory(ctx.cwd)`, muted startup UI, active tool names mirrored from the outer session, and a bridged execution UI. The backend resolves the executable definition with `session.getToolDefinition()`, applies `prepareArguments`, validates with `validateToolArguments()`, then calls `definition.execute(...)` directly with a nested extension context and a sticky abort signal. The pending run is a focused `ctx.ui.custom()` component; Esc aborts that signal, including before execution starts. Aborted runs are displayed as error Manual Tool Runs. It intentionally bypasses Agent Tool Policy hooks. Thrown errors become text `AgentToolResult`s with `isError: true`.

Startup extension mirroring uses Pi's exported `parseArgs(process.argv.slice(2))` for `-e` / `--extension`, `--no-extensions`, and extension flag values.

While running, a focused custom component shows the pending call, Esc abort hint, and latest partial tool update when provided. On completion, a `lovely-dev-tools.run-tool` renderer shows the completed call and raw result output:

- errors use `toolErrorBg`
- success uses `toolSuccessBg`

`resultText()` renders text blocks directly and non-text/non-image blocks as `[type]` plus JSON details. Image result blocks are normalized from either top-level or `source`-shaped data, then render inline when supported; otherwise the original image bytes are saved under `/tmp/pi-tool-image-<uuid>.<ext>` and the text fallback points to that path. Non-PNG image blocks are converted with Pi's `convertToPng()` before storing results for Kitty-compatible terminals. Conversion/save failures are warnings and display degradation, not Manual Tool Run failures.

### `/show-sysprompt`

`/show-sysprompt` waits for idle, then emits two displayed custom messages:

- rendered system prompt from `ctx.getSystemPrompt()`
- active tool schemas from `pi.getAllTools()` filtered by `pi.getActiveTools()`

Both messages use collapsible custom renderers, are filtered out of LLM context, and are skipped in session tree preparation. Tool schema formatting shows each active tool, its top-level parameters, required/optional status, inferred schema type, and parameter description when present.
