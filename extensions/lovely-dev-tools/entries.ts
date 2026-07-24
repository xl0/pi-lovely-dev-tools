import type { AgentToolResult } from "@earendil-works/pi-coding-agent"
import { isRecord } from "./schema"

export const RUN_TOOL_ENTRY_TYPE = "lovely-dev-tools.run-tool"
export const SYSTEM_PROMPT_ENTRY_TYPE = "lovely-dev-tools.system-prompt"
export const TOOL_SCHEMAS_ENTRY_TYPE = "lovely-dev-tools.tool-schemas"
export const CONTEXT_READ_MAP_ENTRY_TYPE = "lovely-dev-tools.context-read-map"
export const LLM_STATS_ENTRY_TYPE = "lovely-dev-tools.llm-stats"
export const LLM_CALL_CONSTRAINTS_ENTRY_TYPE = "lovely-dev-tools.llm-call-constraints"

export type ImageFallback = {
	mimeType: string
	path: string
}

export type RunToolData = {
	toolName: string
	toolArgs: Record<string, unknown>
	toolCallId: string
	result: AgentToolResult<unknown>
	isError: boolean
	imageFallbacks?: ImageFallback[]
}

export function isRunToolData(value: unknown): value is RunToolData {
	if (!isRecord(value)) return false
	const data = value as Partial<RunToolData>
	return (
		typeof data.toolName === "string" &&
		isRecord(data.toolArgs) &&
		typeof data.toolCallId === "string" &&
		isRecord(data.result) &&
		typeof data.isError === "boolean"
	)
}
