# TODO

## Plan

- [x] Create package template.
- [x] Add `/run-tool` command.
- [x] Store rendered call/result history outside LLM context.
- [x] Map selected tool schemas to a SettingsList-style TUI argument editor.
- [x] Execute configured tool definitions via `ctx.getToolDefinition()`.

## Tasks

- [x] Discover session/custom-message shape for displayed-but-filtered history.
- [x] Build tool selector.
- [x] Build schema-driven argument editor.
- [x] Reconstruct JSON args from edited setting rows.
- [x] Execute tool and render result/error.
- [x] Typecheck and format.

## Follow-ups

- [ ] Improve argument editor finishing UX. Currently Escape accepts/done because SettingsList only has cancel semantics.
- [ ] Add explicit validation before executing: required fields still `<omit>` should block with an error.
- [ ] Improve array editing beyond raw JSON input.
- [ ] Render image/non-text tool result blocks better than `[type]` placeholders.
- [ ] Consider using native tool renderers for call/result custom messages if Pi exposes a public renderer API.
