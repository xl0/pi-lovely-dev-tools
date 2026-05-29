# @xl0/pi-lovely-dev-tools

Pi extension package for small development/debugging helpers.

## Demo

[![Demo](https://raw.githubusercontent.com/xl0/pi-lovely-dev-tools/master/assets/demo.gif)](https://raw.githubusercontent.com/xl0/pi-lovely-dev-tools/master/assets/demo.mp4)

## Commands

- `/tool [tool_name] [flat args...]` — run a Manual Tool Run, optionally passing flat args in schema property order (for example `/tool read file.txt 10 20`). Without flat args, opens a searchable tool selector and schema-driven arg editor. Results are displayed in chat, hidden from LLM context, abortable with Ctrl-C, and show partial updates while running.
- `/show-sysprompt` — show the current rendered system prompt and active tool schemas as collapsible custom messages. These entries are hidden from LLM context and omitted from session tree summaries.

## `/tool` execution model

Pi exposes tool schemas to extensions, not executable tool definitions. For each Manual Tool Run this package creates a short-lived in-memory Nested Execution Session using Pi's public SDK, mirrors startup extensions/flags, resolves the selected executable tool there, runs it directly, then disposes the nested session. The outer session owns selection, argument editing, display, and hidden-from-context messages.

Manual Tool Runs intentionally bypass Agent Tool Policy hooks. Active/inactive tool state only affects Agent Tool Calls; inactive tools remain runnable manually when visible.

## Install

```bash
pi install npm:@xl0/pi-lovely-dev-tools
```

Or load without installing:

```bash
pi -e npm:@xl0/pi-lovely-dev-tools
```
