import type { ExtensionAPI } from "@earendil-works/pi-coding-agent"
import { registerHiddenMessageFilters } from "./messages"
import { registerShowSyspromptCommand } from "./show-sysprompt"
import { registerToolCommand } from "./tool-command"

export default function lovelyDevToolsExtension(pi: ExtensionAPI) {
	registerToolCommand(pi)
	registerShowSyspromptCommand(pi)
	registerHiddenMessageFilters(pi)
}
