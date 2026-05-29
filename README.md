# @xl0/pi-lovely-dev-tools

Pi extension package with interactive debugging helpers.

## Demo

[![Demo](https://raw.githubusercontent.com/xl0/pi-lovely-dev-tools/master/assets/demo.gif)](https://raw.githubusercontent.com/xl0/pi-lovely-dev-tools/master/assets/demo.mp4)

## Commands

### `/tool [tool_name] [flat args...]`

Run a Manual Tool Run: a user-triggered tool call displayed in chat and hidden from LLM context.

- With no args, opens a searchable tool selector and schema-driven arg editor.
- With flat args, maps values to top-level schema properties in schema order.
- Shows partial tool updates while running.
- Press Esc to abort a running tool.
- Inactive tools are still visible/runnable manually; active state only controls Agent Tool Calls.

Example:

```text
/tool read file.txt 10 20
```

### `/show-sysprompt`

Show the current rendered system prompt and active tool schemas as collapsible custom messages. These entries are hidden from LLM context and omitted from session tree summaries.

## `/tool` execution model

Pi extensions can see tool schemas, but not executable tool definitions. For each Manual Tool Run this package creates a short-lived in-memory Nested Execution Session using Pi's public SDK, mirrors startup extensions/flags, resolves the selected executable tool there, runs it directly, then disposes the nested session.

The outer session owns selection, argument editing, pending UI, final display, and hidden-from-context messages. Manual Tool Runs intentionally bypass Agent Tool Policy hooks.

## Install

```bash
pi install npm:@xl0/pi-lovely-dev-tools
```

Load without installing:

```bash
pi -e npm:@xl0/pi-lovely-dev-tools
```
