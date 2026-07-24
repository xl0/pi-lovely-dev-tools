# Plan

Ship a small Pi extension package of interactive debugging helpers.

Intent: give the human the same visibility and reach into a session that the LLM has.
Run any tool by hand, see what is actually in the context window, see what each LLM call cost.
Everything these commands emit is display-only and must never leak back into LLM context.

`/tool` runs tools for real, not as a simulation: a single-use Nested Execution Session
provides executable definitions and runtime context, while the outer session provides
UI and tool metadata.
Agent Tool Policy hooks are deliberately bypassed - a manual run is the human's call.

## TODO

- [x] `/tool`: selector, flat args, schema arg editor, focused pending UI with Esc abort
- [x] `/tool` nested execution backend, incl. startup extension mirroring and graceful shutdown
- [x] `/tool` result rendering: partial updates, images, non-text blocks
- [x] `/show-context`: Context Read Map and context token breakdown
- [x] `/llm-stats`: per-call token usage and provider-side tool constraint annotations
- [x] docs, ADR, CONTEXT, README synced for release

## Remaining

No planned code work.
Before publishing, rerun `bun run check` and the package dry-run if anything changes.
