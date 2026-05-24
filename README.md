# @xl0/pi-lovely-dev-tools

Pi extension package for small development/debugging helpers.

## Commands

- `/tool [tool_name] [flat args...]` — run a tool, optionally passing flat args in schema property order (for example `/tool read file.txt 10 20`). Without flat args, opens a searchable tool selector and schema-driven arg editor. Rendered call/result entries are hidden from LLM context.

## Install

```bash
pi install npm:@xl0/pi-lovely-dev-tools
```

Or load without installing:

```bash
pi -e npm:@xl0/pi-lovely-dev-tools
```
