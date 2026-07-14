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

The outer session owns selection, argument editing, pending UI, final display, and display-only custom entries. Manual Tool Runs intentionally bypass Agent Tool Policy hooks.

### `/show-sysprompt`

Show the current rendered system prompt and active tool schemas. Use this to better undersand why your agent behaves the way it does.

### `/show-context`

Show a visual token breakdown and file coverage map for the current model context. Token estimates split the prompt prefix and effective messages into system prompt, context files, advertised/loaded skills, tool definitions, user/assistant content, thinking, tool calls/results (cumulative and per tool), compactions, branch summaries, shell runs, custom messages, and media. The file map includes startup context files, advertised skill metadata, loaded skill bodies, and `read` tool results that survived compaction. The result is a display-only custom entry.
![Context read map](https://raw.githubusercontent.com/xl0/pi-lovely-dev-tools/master/assets/show-context.png)

### `/llm-stats`
Show one row per completed assistant/LLM call in the current branch, with elapsed time since the previous agent message as `+Ns` (or the entry timestamp as `hh:mm:ss` when none), initiation source, and prompt-side tokens rendered as `fresh + cacheR = input` or `fresh + cacheR + cacheW = input` when cache writes are present. The entry timestamp is highlighted in red when it increases by more than 2x from the previous row. The result is a display-only custom entry.

![Context read map](https://raw.githubusercontent.com/xl0/pi-lovely-dev-tools/master/assets/llm-stats.png)
## Install

```bash
pi install npm:@xl0/pi-lovely-dev-tools
```

Load without installing:

```bash
pi -e npm:@xl0/pi-lovely-dev-tools
```

## Related projects

|  |  |
| --- | --- |
| [Pi Lovely Web](https://github.com/xl0/pi-lovely-web) | `web_search`, `web_fetch`, `web_image` tools |
| [Pi Lovely Codex](https://github.com/xl0/pi-lovely-codex) | GPT fast mode and Codex-style `apply_patch` tool |
| [Pi Lovely IDE](https://github.com/xl0/pi-lovely-ide) | IDE integration |
| [Pi Lovely Config](https://github.com/xl0/pi-lovely-config) | scoped config helpers for Pi extensions |
| [Pi Lovely Comment](https://github.com/xl0/agent-files/tree/master/pi/packages/pi-lovely-comment) | open the last assistant message in your editor and sync edits back into the prompt |
| [Pi Lovely Rename](https://github.com/xl0/agent-files/tree/master/pi/packages/pi-lovely-rename) | automatic and manual session naming |

---

Like this work? [Hire me](https://alexey.work/cv?ref=pi-lovely-dev-tools)
