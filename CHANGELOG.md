# Changelog

## [Unreleased]

### Added

- Read map shows a compact per-file token contribution and sorts files by contribution within their group.

### Fixed

- Advertised skills are only counted and listed when Pi actually injects skill metadata (a `read`/`bash` tool is available), using the matching read/bash prompt variant.
- Read-map bar cells no longer emit a hyperlink escape per cell; the filename deep-links to the strongest evidence range instead.

## [0.3.4] - 2026-07-23

### Added

- `/llm-stats` annotates calls made under provider-side constraints (`json_schema`, `grammar:lark`, `grammar:regex`).

## [0.3.3] - 2026-07-22

### Added

- `/llm-stats` gains a think column for provider-reported thinking tokens.

### Fixed

- `/show-context` sizes hidden/summarized thinking from `usage.reasoning` instead of the visible text.

## [0.3.2] - 2026-07-17

### Fixed

- `/tool` shuts its nested session down gracefully; disposal failures mark the run errored instead of trapping the UI.

## [0.3.1] - 2026-07-14

- No code changes over 0.2.3; version alignment after 0.3.0 went out on a side branch.

## [0.3.0] - 2026-06-04

### Removed

- Bundled grill skill, superseded by the global version.

## [0.2.3] - 2026-07-14

### Added

- `/show-context` gains the context token breakdown: per-section token rows with a full-window usage bar.

### Changed

- `/tool` results render as display-only entries and no longer enter LLM context.

## [0.2.2] - 2026-06-13

### Added

- `/show-context` context read map: per-file read evidence with braille bars, recency coloring, and deep links.
- `/llm-stats`: per-LLM-call table with timing deltas, cache read/write tokens, and cache-shrinkage warnings.

### Fixed

- `/tool` runs inherit the outer UI mode in the nested session; display-only messages stay out of message content.

## [0.2.1] - 2026-06-01

### Fixed

- `/tool` menu rows stay single-line by collapsing whitespace in tool descriptions.
- Arg-editor help text no longer overflows the terminal width.

## [0.2.0] - 2026-05-29

### Added

- Initial release: `/tool` (searchable selector, schema-driven argument editor, nested-session execution, image result rendering) and `/show-sysprompt`.
