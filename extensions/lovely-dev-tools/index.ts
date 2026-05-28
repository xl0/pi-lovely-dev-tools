import type { ExtensionAPI } from "@earendil-works/pi-coding-agent"
import { HIDDEN_MESSAGE_TYPES } from "./messages"
import { isRecord } from "./schema"
import { registerShowSyspromptCommand } from "./show-sysprompt"
import { registerToolCommand } from "./tool-command"

export default function lovelyDevToolsExtension(pi: ExtensionAPI) {
	registerToolCommand(pi)
	registerShowSyspromptCommand(pi)

	pi.on("session_before_tree", (event, ctx) => {
		const entry = ctx.sessionManager.getEntry(event.preparation.targetId)
		if (entry?.type === "custom_message" && HIDDEN_MESSAGE_TYPES.has(entry.customType)) return { cancel: true }
	})

	pi.on("context", event => ({
		messages: event.messages.filter(message => {
			if (!isRecord(message) || message.role !== "custom") return true
			return !HIDDEN_MESSAGE_TYPES.has(message.customType)
		})
	}))
}
