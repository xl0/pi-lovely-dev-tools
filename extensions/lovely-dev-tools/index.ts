import type { ExtensionAPI } from "@earendil-works/pi-coding-agent"
import { registerHiddenMessageFilters } from "./messages"
import { registerShowContextCommand } from "./show-context"
import { registerShowSyspromptCommand } from "./show-sysprompt"
import { registerToolCommand } from "./tool-command"

export default function lovelyDevToolsExtension(pi: ExtensionAPI) {
	registerToolCommand(pi)
	registerShowSyspromptCommand(pi)
	registerShowContextCommand(pi)
	registerHiddenMessageFilters(pi)
}
