# Changelog

## [Unreleased]

### Added

- Read map shows a compact per-file token contribution and sorts files by contribution within their group.

### Fixed

- Advertised skills are only counted and listed when Pi actually injects skill metadata (a `read`/`bash` tool is available), using the matching read/bash prompt variant.
- Read-map bar cells no longer emit a hyperlink escape per cell; the filename deep-links to the strongest evidence range instead.
