# TODO

## Current state

`/tool` is a Pi extension command. It uses the outer session for UI/tool metadata and creates one single-use Nested Execution Session per Manual Tool Run for executable tool definitions and runtime context.

Implemented:

- [x] selector, flat args, schema arg editor
- [x] hidden Manual Tool Run custom messages
- [x] nested execution backend via `createAgentSessionServices()` + `createAgentSessionFromServices()`
- [x] startup `-e` / `--extension` / `--no-extensions` / extension flag mirroring via `parseArgs(process.argv.slice(2))`
- [x] muted nested startup UI and bridged execution UI
- [x] direct `prepareArguments` + `validateToolArguments()` + `definition.execute(...)`
- [x] active-tool-name mirroring for nested context introspection
- [x] Ctrl-C abort path for pending Manual Tool Runs
- [x] partial `onUpdate` rendering in pending widget; final session stores final result only
- [x] image display cleanup: inline when supported, `/tmp/pi-tool-image-<uuid>.<ext>` fallback otherwise
- [x] missing nested tool errors include nested diagnostics
- [x] docs/ADR/context synced for nested backend

## Remaining work

### Code cleanup

- [ ] Decouple `arg-editor.ts` from `ExtensionCommandContext`; use a small UI host interface.
- [ ] Keep flat arg parsing independent of Pi extension types.
- [ ] Consider central image block normalization if more image shapes appear.

### Rendering

- [ ] Revisit native `ToolExecutionComponent` rendering only if Pi exposes a clean public API or raw-ish rendering becomes insufficient.
- [ ] Render non-image, non-text tool result blocks better than `[type]` placeholders.

### Docs / release

- [ ] Final README pass before publish.
- [ ] Run `bun run check` before release.
