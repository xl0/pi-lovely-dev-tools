# Live session mode for manual tool runs

Session-affine tools (Lovely Agents' `agent`, `task_list`, `task_output`) partition ownership by `ctx.sessionManager.getSessionId()`, so the default isolated **Manual Tool Run** cannot see or steer live-session work: detached children die with the nested session and task references resolve to nothing. `/tool --live` therefore executes the nested-resolved tool definition with the live session context, keeping nested isolation the default.

## Considered Options

- Persist one **Nested Execution Session** across `/tool` calls: rejected — per-run abort, live-session keying, reload/quit/new/resume/fork rebinding, and completions targeting an invisible conversation cost more than it buys, and tasks would still belong to a synthetic parent.
- Second extension runtime on the outer session UUID: rejected — two runtimes claiming one identity could compete for shutdown hooks, partition leases, notification routes, and reconciliation.

## Consequences

- Pi exposes no executable outer tool path (`getAllTools` is metadata only), so the definition object comes from the nested session while the execution context is live. Definition closures over the nested `pi` handle (e.g. `agent_roster`'s tool list) still observe nested state.
- Control-plane actions in a **Live Session Run** can mutate the real session; the pending UI and stored entry both say so. Abort is delivered only through the tool's `signal` parameter (the outer `ctx.signal`/`ctx.abort()` belong to the live session and are not remapped), and no outer shutdown is ever emitted.
