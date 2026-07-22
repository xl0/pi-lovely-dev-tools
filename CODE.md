# Codebase

Pi package `@xl0/pi-lovely-dev-tools`: extension commands for interactive debugging.
Domain language lives in `CONTEXT.md`; `docs/adr/0001` explains why `/tool` stays an extension
running through a nested SDK session.

## Structure

- `package.json`: pi manifest. Loads `./extensions`; `pi.video` links `assets/demo.mp4` via raw
  GitHub URL; `assets/` stays in repo, not in the npm package. `@earendil-works/pi-ai` is a
  peer/dev dep for direct `validateToolArguments()` imports.
- `extensions/lovely-dev-tools/`
  - `index.ts`: entrypoint, registers command modules.
  - `entries.ts`: custom entry type constants, `/tool` entry data guard.
  - `schema.ts`: JSON-schema helpers - defaults, enum/type display, coercion, arg formatting.
  - `arg-editor.ts`: schema-driven arg editor; depends only on extension UI plus tool
    name/description/schema, not the full command context.
  - `tool-command.ts`: `/tool` selector, flat arg parsing, pending run component, result rendering.
  - `tool-backend.ts`: single-use Nested Execution Session backend.
  - `show-sysprompt.ts`, `show-context.ts`, `llm-stats.ts`: the other three commands.

All four commands wait for idle and append display-only custom entries.
Pi custom entries never enter LLM context.

## `/tool`

`/tool [tool_name] [flat args...]`: searchable selector when no name given, inline arg editor when
no flat args, then executes and appends one entry.

- selector search and `<tab>` autocomplete match tool names only; unknown names pre-seed the search
- inactive tools are runnable; active/inactive only marks LLM availability
- flat args map to top-level schema properties in schema order, shell-style quotes preserved
- entry type `lovely-dev-tools.run-tool`, `data`: `toolName`, `toolArgs`, `toolCallId`, `result`,
  `isError`, optional `imageFallbacks`

### Argument editor

`editToolArgs()` renders schema paths into rows and mutates a nested args object directly.

- optional fields default to omitted (`[ ]`/`[x]` toggles); omitted is absent from final args and
  distinct from empty string
- required fields default from schema default/const/enum, else the simple type default
- `+`/`-` insert/remove array items, also from child rows
- booleans and enums cycle with Space; scalars edit inline, commit and validate on move-away/Enter
- Escape returns to selection/cancel, Enter runs

### Execution

Each run creates a single-use nested SDK session (`createAgentSessionServices()` /
`createAgentSessionFromServices()`, `SessionManager.inMemory(ctx.cwd)`) with muted startup UI,
active tool names mirrored from the outer session, and bridged execution UI/mode.
Startup extension mirroring parses `-e`/`--extension`/`--no-extensions` from Pi's exported
`parseArgs(process.argv.slice(2))`.

The backend resolves via `session.getToolDefinition()`, applies `prepareArguments`, validates with
`validateToolArguments()`, then calls `definition.execute(...)` with a nested extension context and
a sticky abort signal. Intentionally bypasses Agent Tool Policy hooks.

- Esc aborts, even before execution starts; aborts and thrown errors become `isError: true` entries
- disposal awaits nested `session_shutdown` handlers before invalidating the nested context;
  disposal failures mark the run errored without trapping the pending UI

### Result rendering

Text blocks render directly, other non-image blocks as `[type]` plus JSON.
Image blocks are normalized from top-level or `source`-shaped data and rendered inline when
supported, else saved to `/tmp/pi-tool-image-<uuid>.<ext>` (non-PNG through Pi's `convertToPng()`).
Conversion/save failures degrade display only, never fail the run.

## `/show-context`

Renders a Context Token Breakdown then a Context Read Map. Both are built from the *built model
context* (`buildSessionContext()`), not raw branch history, so compacted-away reads disappear.
Other extensions' context-hook mutations and provider-payload rewrites are not applied.

### Token breakdown

Pi's `chars / 4` convention, 1,200 tokens per image; provider framing/tokenizer overhead excluded.
Pi's usage meter is shown alongside, not reconciled with the decomposition.
Assistant thinking is `max(visible thinking chars / 4, usage.reasoning)` per message - providers
with hidden/summarized thinking replay the full reasoning, not the visible block text.
Rows: prompt prefix (base system text, startup context files, advertised skills, tool definitions)
then messages (user, loaded skill bodies, assistant text/thinking, tool calls/results with per-tool
child rows, compaction/branch summaries, shell runs, custom messages, media).
The bar spans the full context window, unused capacity as dim track.

### Read map

One row per file: context files, then advertised skills, then read files by most recent evidence.
Evidence kinds: startup context file ranges, advertised skill frontmatter, `/skill:name` loaded
body ranges, successful `read` results matched by `toolCallId`. Media-producing reads count as
whole-file reads. Skill body detection runs `parseSkillBlock()` on user messages only.
Line counts are queried at command time; missing files stay visible with a warning marker.

Bars: 10 lines per braille half-cell column, count glyphs `ˍ` to `⣿`, recency coloring for reads,
`borderAccent`/`accent` for context files and skills. At >=100 columns: fixed 50-col filename
column with OSC8 `file://` links; narrower terminals stack bars under filenames.
Layout derives from component render width, so entries adapt to resizes.

## `/llm-stats`

One row per finalized assistant entry with `usage` in `ctx.sessionManager.getBranch()` (per LLM
call, not per tool call): elapsed since previous agent message as `+Ns` (timestamp for the first),
`provider/model`, inferred start (`user`, `tools`, `other`), `fresh + cacheR (+ cacheW) = input`,
output, `think` (`usage.reasoning`, column shown only when some row reports it), stop reason,
tool calls. `cacheR` shrinkage vs. previous row is warning yellow, error red past 50%.

## `/show-sysprompt`

Appends two collapsible entries, hidden from the default session tree view: rendered
`ctx.getSystemPrompt()`, and active tool schemas (`pi.getAllTools()` filtered by
`pi.getActiveTools()`) with top-level params, required/optional, inferred type, description.
