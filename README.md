# @xl0/pi-lovely-dev-tools

Interactive debugging commands for [Pi](https://github.com/earendil-works/pi): run tools by hand, inspect the system prompt, and see why the models act stupid.

[![Demo](https://raw.githubusercontent.com/xl0/pi-lovely-dev-tools/master/assets/demo.gif)](https://raw.githubusercontent.com/xl0/pi-lovely-dev-tools/master/assets/demo.mp4)

## Install

```bash
pi install npm:@xl0/pi-lovely-dev-tools
```

Or load without installing:

```bash
pi -e npm:@xl0/pi-lovely-dev-tools
```

## Commands

### `/tool [tool_name] [args...]`

Run any tool yourself. The result is displayed for you to review, not sent to the LLM.

- `/tool` alone opens a searchable tool selector and a schema-driven argument editor.
- Positional args map onto the tool's top-level schema properties in order.
- Partial updates stream while the tool runs; Esc aborts.
- Inactive tools can still be run manually — active state only gates the agent's own calls.

```text
/tool
/tool read README.md
/tool bash "bun run check"
/tool bash "sleep 30"  # press Esc to abort
```
Manual runs intentionally bypass tool policy hooks.

### `/show-sysprompt`

Show the rendered system prompt and active tool schemas — useful when the agent isn't behaving the way you expect.

### `/show-context`

Show an estimated token breakdown of the current context — system prompt, context files, skills, tool definitions, messages, thinking, tool calls and results (total and per tool), compactions, and more — plus a coverage map and compact token count for each file the model has actually seen: startup context files, skills, and `read` results that survived compaction.

![show-context output](https://raw.githubusercontent.com/xl0/pi-lovely-dev-tools/master/assets/show-context.png)

### `/llm-stats`

Show one row per LLM call in the current branch: time since the previous agent message, model, what initiated the call, prompt tokens as `fresh + cacheR (+ cacheW) = input`, output tokens, thinking tokens (when the provider reports them), stop reason, and tool calls. Constrained calls are annotated with `[json_schema]`, `[grammar:lark]`, or `[grammar:regex]`. The cache-read column is highlighted when cache reads drop from the previous call — a sign you lost your prompt cache.

![llm-stats output](https://raw.githubusercontent.com/xl0/pi-lovely-dev-tools/master/assets/llm-stats.png)

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
