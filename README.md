# @xl0/pi-lovely-dev-tools

Pi extension package for small development/debugging helpers.

## Commands

- `/run-tool [tool_name]` — store a synthetic tool-call fixture via the TUI. Arguments are prompted from the selected tool schema, rendered as one custom history entry, and projected into user/tool-call/tool-result messages for LLM context.

## Install

```bash
pi install npm:@xl0/pi-lovely-dev-tools
```

Or load without installing:

```bash
pi -e npm:@xl0/pi-lovely-dev-tools
```
