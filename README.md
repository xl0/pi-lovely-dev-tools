# @xl0/pi-lovely-dev-tools

Pi extension package with interactive debugging helpers.

## Demo

## Commands

### `/tool [tool_name] [flat args...]`

Use this to manually execute your tools. Results are not sent to the LLM; they are for you to review.

- With no args, opens a searchable tool selector and schema-driven arg editor.
- With flat args, maps values to top-level schema properties in schema order.
- Shows partial tool updates while running.
- Press Esc to abort a running tool.
- Inactive tools are still visible/runnable manually; active state only controls Agent Tool Calls.

Examples:

```text
/tool
/tool read README.md
/tool bash "bun run check"
/tool bash "sleep 30"  # press Esc to abort
```


[![Demo](https://raw.githubusercontent.com/xl0/pi-lovely-dev-tools/master/assets/demo.gif)](https://raw.githubusercontent.com/xl0/pi-lovely-dev-tools/master/assets/demo.mp4)

##### How it works

Pi extensions can see tool schemas, but not executable tool definitions. For each Manual Tool Run this command creates a short-lived in-memory Nested Execution Session using Pi SDK, mirrors startup extensions/flags, resolves the selected executable tool there, runs it directly, then disposes the nested session.

The outer session owns selection, argument editing, pending UI, final display, and hidden-from-context messages. Manual Tool Runs intentionally bypass Agent Tool Policy hooks.

### `/show-sysprompt`

Show the current rendered system prompt and active tool schemas. Use this to better undersand why your agent behaves the way it does.

## Install

```bash
pi install npm:@xl0/pi-lovely-dev-tools
```

Load without installing:

```bash
pi -e npm:@xl0/pi-lovely-dev-tools
```
