# Lovely Dev Tools

Lovely Dev Tools adds interactive debugging utilities to Pi while keeping manual inspection separate from the agent's model-driven work.

## Language

**Manual Tool Run**:
A user-initiated, abortable one-shot tool call launched from `/tool`, selected and parameterized by the human, displayed in chat, and hidden from LLM context.
_Avoid_: manual execution, tool execution

**Manual Tool Runner**:
The feature that lets a human perform a **Manual Tool Run**.
_Avoid_: `/tool` implementation, tool UI

**Agent Tool Call**:
A model-initiated tool call that belongs to the agent loop and may affect the LLM context.
_Avoid_: automatic tool run, normal tool execution

**Agent Tool Policy**:
Extension-defined gating or result transformation applied to an **Agent Tool Call**.
_Avoid_: tool hook, permission hook

**Static Startup Tool**:
A tool loaded from built-ins, discovered settings/packages/extensions, current process `-e`/`--extension` arguments, or startup extension flag values during session startup.
_Avoid_: static tool, reproducible tool

**Nested Execution Session**:
A short-lived, in-memory SDK session that supplies tool definitions and runtime context for exactly one **Manual Tool Run**.
_Avoid_: child session, backend session

**Bridged Tool UI**:
An execution-time UI adapter that delegates a **Nested Execution Session** tool's user interaction to the outer Pi command UI.
_Avoid_: second TUI, nested terminal

## Relationships

- A **Manual Tool Runner** creates zero or more **Manual Tool Runs**.
- A **Manual Tool Run** invokes any configured tool, including tools inactive for **Agent Tool Calls**.
- A tool being active means it is available to the LLM for **Agent Tool Calls**; it is not an execution gate for **Manual Tool Runs**.
- The **Nested Execution Session** mirrors the outer active tool names for context introspection, not for execution gating.
- A **Manual Tool Run** is displayed to the user and hidden from LLM context.
- A **Manual Tool Run** executes the selected tool directly and intentionally bypasses **Agent Tool Policies**.
- If the tool selected for a **Manual Tool Run** cannot be resolved by the execution backend, the run fails explicitly instead of falling back to another execution path.
- Nested startup diagnostics are surfaced to help explain **Manual Tool Run** backend mismatches.
- A **Manual Tool Run** uses exactly one **Nested Execution Session**.
- A **Nested Execution Session** is single-use and must not be cached across **Manual Tool Runs**.
- A **Nested Execution Session** does not persist session history; the outer session stores only the displayed **Manual Tool Run** message.
- A **Nested Execution Session** uses muted UI during startup and **Bridged Tool UI** during selected tool execution.
- A manually run tool receives the **Nested Execution Session** context, not the outer command context; only UI interaction is bridged outward.
- Side effects emitted through nested `pi.sendMessage` / `pi.sendUserMessage` stay inside the **Nested Execution Session** and do not affect the outer session.
- Control-plane actions from a manually run tool affect only the **Nested Execution Session** or no-op; they must not control the outer Pi session.
- A **Manual Tool Run** passes an abort signal to the selected tool so long-running work can be cancelled.
- An aborted **Manual Tool Run** is displayed as an error result and still hidden from LLM context.
- Arguments for a **Manual Tool Run** are prepared and validated before execution; validation failure is displayed as an error result.
- Flat positional arguments are only a convenience for top-level schema fields; complex argument input belongs in the schema editor.
- Partial tool updates during a **Manual Tool Run** are shown only in the pending UI; the outer session stores the final result.
- **Manual Tool Run** results use raw-ish custom rendering rather than Pi's native agent tool renderer.
- Image results remain structured image blocks; text image indicators are display fallbacks only and are omitted when the inline image is rendered.
- When an image result cannot be rendered inline, the original image bytes are saved to `/tmp` and the fallback text points to that file.
- Saved fallback image files are left for the OS temp cleanup rather than tracked or deleted by the extension.
- The outer **Manual Tool Run** message records image fallback paths so reloaded sessions retain the display context.
- The **Manual Tool Runner** may require current Pi helper exports and fail to load on stale Pi installs.
- A **Manual Tool Run** only guarantees execution for **Static Startup Tools**; tools added dynamically during the current session may be visible but fail explicitly.
- Extension CLI flags are part of startup state; nested execution mirrors them so `pi.getFlag()`-dependent tools behave like the outer session.

## Example dialogue

> **Dev:** "If I run `read` from the **Manual Tool Runner**, should the model see that result?"
> **Domain expert:** "No — a **Manual Tool Run** is for human inspection. If the model needs the file, ask it to make an **Agent Tool Call**."

## Flagged ambiguities

- "manual tool execution" was resolved as **Manual Tool Run** when referring to one invocation, and **Manual Tool Runner** when referring to the feature.
- "active tool" was resolved as **Agent Tool Call** availability only; inactive tools may still be invoked by a **Manual Tool Run**.
- "child session" was resolved as **Nested Execution Session**: a single-use source of tool definitions and runtime context, not an agent-loop session for **Manual Tool Runs**.
