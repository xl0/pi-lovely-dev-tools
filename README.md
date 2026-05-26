# @xl0/pi-lovely-dev-tools

Pi extension package for small development/debugging helpers.

## Demo

[![Demo](https://raw.githubusercontent.com/xl0/pi-lovely-dev-tools/master/assets/demo.gif)](https://raw.githubusercontent.com/xl0/pi-lovely-dev-tools/master/assets/demo.mp4)

## Commands

- `/tool [tool_name] [flat args...]` — run a tool, optionally passing flat args in schema property order (for example `/tool read file.txt 10 20`). Without flat args, opens a searchable tool selector and schema-driven arg editor. Rendered call/result entries are hidden from LLM context.
- `/show-sysprompt` — show the current rendered system prompt and active tool schemas as collapsible custom messages. These entries are hidden from LLM context and omitted from session tree summaries.

## Install

```bash
pi install npm:@xl0/pi-lovely-dev-tools
```

Or load without installing:

```bash
pi -e npm:@xl0/pi-lovely-dev-tools
```
