# Manual Tool Runner stays an extension

The Manual Tool Runner remains the `/tool` command inside the Pi extension instead of becoming a standalone TUI app or requiring Pi to expose executable tools through `ExtensionAPI`.

A short-lived Nested Execution Session supplies executable tool definitions and runtime context for each Manual Tool Run. The outer extension still owns tool selection, argument editing, pending display, abort input, partial update rendering, final result display, and display-only custom entries.

Manual Tool Runs execute the selected definition directly with prepared/validated arguments and a nested extension context. They intentionally bypass Agent Tool Policy hooks. After the run, nested `session_shutdown` handlers complete before the Nested Execution Session invalidates its extension context.
