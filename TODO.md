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
- [x] focused pending Manual Tool Run UI with Esc abort
- [x] partial `onUpdate` rendering in focused pending UI; final session stores final result only
- [x] image display cleanup: inline when supported, `/tmp/pi-tool-image-<uuid>.<ext>` fallback otherwise
- [x] non-image, non-text result blocks render as `[type]` plus JSON details
- [x] missing nested tool errors include nested diagnostics
- [x] docs/ADR/context synced for nested backend
- [x] README cleaned for release
- [x] `bun run check` passes
- [x] package dry-run checked

## Remaining work

No planned code work. Before publishing, rerun `bun run check` and package dry-run if anything changes.
