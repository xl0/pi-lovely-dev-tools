# TODO

## Direction

Build the next `/tool` as a normal Pi package extension, not a standalone binary and not a patched `ToolInfo.execute` extension.

The extension still owns the command/UI inside the current Pi session. When it needs to execute a tool, it creates a short-lived nested SDK `AgentSession` and uses the public session API (`getToolDefinition()` plus `extensionRunner.createContext()`) to access executable tool definitions and runtime context.

## Motivation

- `pi install npm:@xl0/pi-lovely-dev-tools` distribution stays simple.
- Current `/tool` UX can mostly survive: selector, schema arg editor, custom rendered result, hidden-from-context messages.
- Clean Pi intentionally exposes only tool metadata to extensions via `pi.getAllTools()`. A nested SDK session gives us executable definitions without asking upstream to expose execution through `ToolInfo`.
- This keeps the upstream patch small/nonessential: only need utility exports like PNG conversion, not tool execution internals.

## High-level plan

1. Keep `/tool` registered by the package extension.
2. Use the outer extension runtime for UI and source of truth:
   - list tools from `pi.getAllTools()`
   - active/inactive state from `pi.getActiveTools()`
   - current cwd/UI from command `ctx`
3. On `/tool` execution, create a nested SDK session through `createAgentSessionServices()` + `createAgentSessionFromServices()`:
   - `cwd: ctx.cwd`
   - `SessionManager.inMemory(ctx.cwd)`
   - no persisted nested history
   - same agent dir/settings via public SDK defaults
   - `additionalExtensionPaths` / `noExtensions` from exported Pi `parseArgs(process.argv.slice(2))`
   - `extensionFlagValues` from parsed unknown flags
4. Bind nested extensions before resolving tools:
   - call `session.bindExtensions({ uiContext: mutedUi })` so `session_start` / `resources_discover` can register Static Startup Tools and resources
   - switch to a bridged outer UI before direct tool execution when the selected tool may need user interaction
   - do not create a second `ProcessTerminal`
5. Mirror outer active tool names into the nested session for context introspection, then find the executable definition with `nested.session.getToolDefinition(toolName)`.
6. Execute with an explicit direct-run helper:
   - apply `prepareArguments`
   - validate via `validateToolArguments` from `@earendil-works/pi-ai`
   - pass an abort signal
   - call `definition.execute(toolCallId, args, signal, onUpdate, nested.session.extensionRunner.createContext())`
   - pass nested execution context, not outer command context; only UI is bridged
   - do not emit `tool_call` / `tool_result` hooks
7. Render result through the existing raw-ish custom message path. Do not use Pi-native tool renderers initially.
8. Dispose the nested session after the manual run. Do not cache nested sessions.

## Challenges / answers

### Clean extension API cannot execute tools

`ExtensionAPI.getAllTools()` returns metadata only. We do not fight that. The nested SDK `AgentSession` is the executable registry.

### `-e` extensions are CLI-only

They are not persisted in settings, so a fresh nested session would miss them. Rely on upstream Pi exporting `parseArgs` / `Args` from the root API so nested sessions can reuse Pi's exact `-e` / `--extension` / `--no-extensions` and extension-flag parsing. Resolve local `-e` paths relative to the process startup cwd (`process.cwd()`), matching Pi startup, then pass them into nested `DefaultResourceLoader` as `additionalExtensionPaths` / `noExtensions`. Pass parsed unknown long flags as `extensionFlagValues` so nested extension `pi.getFlag()` sees the same CLI flags. Ignore parser diagnostics; Pi already accepted process startup. Do not parse tool allow/deny CLI flags initially; the outer session remains the UI source of truth and missing selected tools fail explicitly.

### Nested session may not exactly match the outer one

Use the outer session's `pi.getAllTools()` as the UI/source of truth. The nested session is only an execution backend. If a selected outer tool is missing in the nested session, fail explicitly with a useful actionable message. No fallback execution path.

Dynamic runtime tool registrations from the outer session are not supported initially. The nested session only reproduces Static Startup Tools: built-ins, discovered settings/packages/extensions, current process `-e` / `--extension` paths, and startup extension flag values.

### Nested extensions can have side effects

Use a single-use Nested Execution Session per `/tool` run and dispose it in `finally`. Do not cache nested sessions. Keep startup UI muted so duplicate `session_start` effects do not pollute the outer session. During tool execution, only UI interactions are bridged. Nested `pi.sendMessage` / `pi.sendUserMessage` side effects stay in the nested in-memory session and do not escape to the outer session. Nested control-plane actions (`shutdown`, `abort`, `compact`, model/tool setters) must not affect the outer Pi session. The nested session may load this same package and register `/tool`; do not suppress it initially because nested commands are contained.

### UI ownership

Never instantiate `ProcessTerminal` from inside the extension. Startup-time nested extension UI is muted to avoid duplicate notifications/status on every Manual Tool Run. Execution-time nested tool UI is bridged to the outer `ctx.ui` when the tool needs interaction. Do not pass the outer command context into nested tool execution.

### Direct execution and validation

Do not run the agent-loop tool-call path for Manual Tool Runs. Apply `prepareArguments`, validate with `validateToolArguments()`, then call `definition.execute(...)` directly with a nested extension context. Validation failure is displayed as a Manual Tool Run error result instead of reopening the editor. Flat positional args remain convenience-only for top-level schema fields; complex input belongs in the editor. This intentionally bypasses `tool_call` / `tool_result` hooks; those are Agent Tool Policy, not Manual Tool Run policy. Keep the direct-run sequence isolated in one helper. Tools that inspect context (`getSystemPrompt`, `sessionManager`, model state) see the nested context, not the outer session.

### Images / PNG conversion

Use Pi's exported `convertToPng()` as a required API. Do not vendor a copy and do not add optional import plumbing; stale Pi installs may fail to load this dev-tool package. If conversion itself fails at display time, do not fail the Manual Tool Run; save the original image to `/tmp` and show a fallback path.

## Broad todo list

### Design checks

- [x] Decide that the Manual Tool Runner remains an extension and delegates execution to a nested SDK session.
- [x] Verify nested `createAgentSessionServices()` / `createAgentSessionFromServices()` typecheck from the extension against current local Pi package.
- [x] Verify nested sessions can load npm/git/local `-e` values from `process.argv`.
- [x] Verify extension tools that use `ctx.ui` work with a bridged nested UI context.
- [x] Decide nested `session_start` / `resources_discover` must run before resolving executable tools.
- [x] Decide dynamic runtime tool registrations are out of scope for the initial nested backend.
- [x] Decide Manual Tool Runs bypass `tool_call` / `tool_result` hooks and call `definition.execute(...)` directly.
- [x] Decide nested `session.bindExtensions()` is needed before tool resolution; direct `extensionRunner.setUIContext()` alone is not enough.

### Refactor reusable pieces

- [ ] Decouple `arg-editor.ts` from `ExtensionCommandContext`; use a small UI host interface.
- [ ] Keep schema helpers package-local and reusable by extension/nested executor.
- [ ] Keep flat arg parsing independent of Pi extension types.

### Nested session backend

- [x] Use upstream exported `parseArgs` / `Args` from Pi root API for startup extension args/flags.
- [x] Add `createToolBackend(ctx, pi)` helper that builds a single-use nested in-memory session via `createAgentSessionServices()` + `createAgentSessionFromServices()` and surfaces nested diagnostics.
- [x] Use `SessionManager.inMemory(ctx.cwd)` for the nested session manager.
- [x] Resolve local CLI `-e` paths relative to process startup cwd and pass them into nested resource loader.
- [x] Pass parsed CLI `--no-extensions` into nested resource loader while still allowing explicit `-e` paths.
- [x] Pass parsed extension CLI flags into `createAgentSessionServices({ extensionFlagValues })` for nested `pi.getFlag()`.
- [x] Bridge minimal nested `ExtensionUIContext` to outer `ctx.ui`.
- [x] Dispose nested session in `finally`.

### Tool execution helper

- [x] Mirror outer `pi.getActiveTools()` into nested `session.setActiveToolsByName(...)` for context introspection.
- [x] Resolve selected tool by name from nested `session.getToolDefinition()`.
- [x] Apply `prepareArguments` when present.
- [x] Validate args with `validateToolArguments()` and display validation failures as error results.
- [x] Add explicit `@earendil-works/pi-ai` peer/dev dependency for validation imports.
- [x] Create an `AbortController` per Manual Tool Run and pass its signal to `definition.execute(...)`.
- [x] Execute `definition.execute(...)` directly with nested `extensionRunner.createContext()`.
- [x] Bypass `tool_call` / `tool_result` hooks intentionally.
- [ ] Provide a UI path to abort a running Manual Tool Run.
- [ ] Support `onUpdate` by rendering the latest partial result in the pending widget while storing only the final result.
- [x] Preserve thrown-error behavior as explicit text tool result.
- [ ] Display aborted Manual Tool Runs as error results and clear/dispose in `finally`.

### UI integration

- [x] Keep current searchable selector and active/inactive labels.
- [x] Keep current schema-driven arg editor.
- [x] Show pending execution widget while nested tool runs.
- [x] Keep displayed custom message hidden from LLM context/session tree.
- [x] Make missing nested tool error actionable and include relevant nested diagnostics.

### Rendering / images

- [x] Use static import of upstream `convertToPng()`; stale Pi versions that do not export it may fail to load.
- [x] Keep current raw text/image custom renderer initially.
- [ ] Revisit native `ToolExecutionComponent` rendering only as a later feature.
- [x] Match Pi image semantics: render inline images when supported, otherwise show a text fallback indicator; do not show both.
- [x] When inline image rendering is unavailable or conversion fails, save original image bytes to `/tmp/pi-tool-image-<uuid>.<ext>` and include that path in fallback text/content/details.
- [x] Leave saved fallback image files for OS temp cleanup.
- [x] Treat image display/conversion failure as display degradation, not Manual Tool Run failure.

### Docs / cleanup

- [ ] Update README to explain clean-Pi-compatible `/tool` implementation.
- [ ] Update `TOOL_UI_REUSE.md` after implementation decisions settle.
- [ ] Remove obsolete notes about relying on patched `ToolInfo.execute`.
- [x] Typecheck and run formatter.
