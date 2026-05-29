import type { AgentToolResult, ExtensionAPI } from "@earendil-works/pi-coding-agent"
import { isRecord } from "./schema"

export const RUN_TOOL_MESSAGE_TYPE = "lovely-dev-tools.run-tool"
export const SYSTEM_PROMPT_MESSAGE_TYPE = "lovely-dev-tools.system-prompt"
export const TOOL_SCHEMAS_MESSAGE_TYPE = "lovely-dev-tools.tool-schemas"
export const HIDDEN_MESSAGE_TYPES = new Set([RUN_TOOL_MESSAGE_TYPE, SYSTEM_PROMPT_MESSAGE_TYPE, TOOL_SCHEMAS_MESSAGE_TYPE])

export type ImageFallback = {
	mimeType: string
	path: string
}

export type RunToolDetails = {
	toolName: string
	toolArgs: Record<string, unknown>
	toolCallId: string
	result: AgentToolResult<unknown>
	isError: boolean
	timestamp: number
	imageFallbacks?: ImageFallback[]
}

export function isRunToolDetails(value: unknown): value is RunToolDetails {
	if (!isRecord(value)) return false
	const details = value as Partial<RunToolDetails>
	return (
		typeof details.toolName === "string" &&
		isRecord(details.toolArgs) &&
		typeof details.toolCallId === "string" &&
		isRecord(details.result) &&
		typeof details.isError === "boolean" &&
		typeof details.timestamp === "number"
	)
}

export function registerHiddenMessageFilters(pi: ExtensionAPI) {
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
