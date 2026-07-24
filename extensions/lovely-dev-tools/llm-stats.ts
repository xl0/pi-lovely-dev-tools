import type { ExtensionAPI, Theme } from "@earendil-works/pi-coding-agent"
import { Box, Text } from "@earendil-works/pi-tui"
import { LLM_CALL_CONSTRAINTS_ENTRY_TYPE, LLM_STATS_ENTRY_TYPE } from "./entries"
import { isRecord, numberValue } from "./schema"

type ToolConstraint = "json_schema" | "grammar:lark" | "grammar:regex"

type LlmCallConstraintsData = {
	assistantTimestamp: number
	tools: Record<string, ToolConstraint>
}

type LlmStatsRow = {
	index: number
	delta: string
	model: string
	start: string
	fresh: number
	cacheRead: number
	cacheWrite: number
	input: number
	output: number
	reasoning: number
	stop: string
	tools: string
}

type LlmStatsData = {
	rows: LlmStatsRow[]
}

function shortNumber(value: number): string {
	if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(value >= 10_000_000 ? 0 : 1)}m`
	if (value >= 1000) return `${(value / 1000).toFixed(value >= 10_000 ? 0 : 1)}k`
	return `${value}`
}

function timestampValue(value: unknown): number | undefined {
	if (typeof value !== "string") return undefined
	const timestamp = Date.parse(value)
	return Number.isFinite(timestamp) ? timestamp : undefined
}

function timestampText(value: number | undefined): string {
	if (value === undefined) return "-"
	return new Date(value).toLocaleTimeString(undefined, { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" })
}

function deltaText(current: number | undefined, previous: number | undefined): string {
	if (current === undefined || previous === undefined) return timestampText(current)
	return `+${Math.max(0, Math.round((current - previous) / 1000))}s`
}

function toolNames(content: unknown, constraints: Record<string, ToolConstraint> = {}): string {
	if (!Array.isArray(content)) return "-"
	const names = content
		.filter(isRecord)
		.map(block => block as { type?: unknown; name?: unknown })
		.filter(block => block.type === "toolCall" && typeof block.name === "string")
		.map(block => {
			const name = block.name as string
			const constraint = constraints[name]
			return constraint ? `${name}[${constraint}]` : name
		})
	return names.length === 0 ? "-" : names.join(",")
}

function field(value: unknown, key: string): unknown {
	return isRecord(value) ? value[key] : undefined
}

function setConstraint(constraints: Map<string, ToolConstraint>, name: unknown, constraint: ToolConstraint) {
	if (typeof name === "string") constraints.set(name.toLowerCase(), constraint)
}

function grammarConstraint(value: unknown): ToolConstraint | undefined {
	if (!isRecord(value)) return undefined
	const syntax = field(value, "syntax")
	if (syntax === "lark" || syntax === "regex") return `grammar:${syntax}`
	return grammarConstraint(field(value, "grammar"))
}

function payloadConstraints(payload: unknown): Map<string, ToolConstraint> {
	const constraints = new Map<string, ToolConstraint>()
	const tools = field(payload, "tools")

	if (Array.isArray(tools)) {
		for (const value of tools) {
			const fn = field(value, "function")
			const custom = field(value, "custom")
			const customFormat = field(custom, "format")
			const grammar = grammarConstraint(isRecord(customFormat) ? customFormat : field(value, "format"))
			if (grammar) setConstraint(constraints, field(custom, "name") ?? field(value, "name"), grammar)
			if (field(value, "strict") === true || field(fn, "strict") === true) {
				setConstraint(constraints, field(fn, "name") ?? field(value, "name"), "json_schema")
			}

			const declarations = field(value, "functionDeclarations")
			const functionConfig = field(field(payload, "toolConfig"), "functionCallingConfig")
			if ((field(functionConfig, "mode") === "VALIDATED" || field(functionConfig, "mode") === "ANY") && Array.isArray(declarations)) {
				for (const declaration of declarations) {
					setConstraint(constraints, field(declaration, "name"), "json_schema")
				}
			}
		}
	}

	const bedrockTools = field(field(payload, "toolConfig"), "tools")
	if (Array.isArray(bedrockTools)) {
		for (const value of bedrockTools) {
			const toolSpec = field(value, "toolSpec")
			if (field(toolSpec, "strict") === true) setConstraint(constraints, field(toolSpec, "name"), "json_schema")
		}
	}

	const contextTools = field(field(payload, "context"), "tools")
	if (Array.isArray(contextTools)) {
		for (const value of contextTools) {
			const config = field(value, "constrainedSampling")
			if (field(config, "type") === "json_schema") setConstraint(constraints, field(value, "name"), "json_schema")
			if (field(config, "type") === "grammar") {
				const variants = field(config, "variants")
				if (typeof field(variants, "openai_lark") === "string") {
					setConstraint(constraints, field(value, "name"), "grammar:lark")
				} else if (typeof field(variants, "openai_regex") === "string") {
					setConstraint(constraints, field(value, "name"), "grammar:regex")
				}
			}
		}
	}

	return constraints
}

function constraintsData(value: unknown): LlmCallConstraintsData | undefined {
	if (typeof field(value, "assistantTimestamp") !== "number" || !isRecord(field(value, "tools"))) return undefined
	return value as LlmCallConstraintsData
}

function callInitiator(previousMessage: unknown): string {
	if (!isRecord(previousMessage)) return "other"
	const role = (previousMessage as { role?: unknown }).role
	if (role === "user") return "user"
	if (role !== "toolResult") return "other"
	return "tools"
}

function pad(value: string, width: number, right = false): string {
	return right ? value.padStart(width) : value.padEnd(width)
}

function formatRows(rows: LlmStatsRow[], theme: Theme): string {
	if (rows.length === 0) return "No assistant messages with usage."
	const showCacheWrite = rows.some(row => row.cacheWrite !== 0)
	const showReasoning = rows.some(row => numberValue(row.reasoning) !== 0)
	const widths = {
		index: Math.max(1, `${rows.length}`.length),
		delta: Math.max("delta".length, ...rows.map(row => row.delta.length)),
		model: Math.max("model".length, ...rows.map(row => row.model.length)),
		start: Math.max("start".length, ...rows.map(row => row.start.length)),
		fresh: Math.max("fresh".length, ...rows.map(row => shortNumber(row.fresh).length)),
		stop: Math.max("stop".length, ...rows.map(row => row.stop.length)),
		cacheRead: Math.max("cacheR".length, ...rows.map(row => shortNumber(row.cacheRead).length)),
		cacheWrite: Math.max("cacheW".length, ...rows.map(row => shortNumber(row.cacheWrite).length)),
		input: Math.max("input".length, ...rows.map(row => shortNumber(row.input).length)),
		output: Math.max("output".length, ...rows.map(row => shortNumber(row.output).length)),
		reasoning: Math.max("think".length, ...rows.map(row => shortNumber(numberValue(row.reasoning)).length))
	}
	const header = [
		pad("#", widths.index, true),
		pad("delta", widths.delta, true),
		pad("model", widths.model),
		pad("start", widths.start),
		pad("fresh", widths.fresh, true),
		"+",
		pad("cacheR", widths.cacheRead, true),
		...(showCacheWrite ? ["+", pad("cacheW", widths.cacheWrite, true)] : []),
		"=",
		pad("input", widths.input, true),
		pad("output", widths.output, true),
		...(showReasoning ? [pad("think", widths.reasoning, true)] : []),
		pad("stop", widths.stop),
		"tools"
	].join("  ")
	const body = rows.map((row, rowIndex) => {
		const previous = rows[rowIndex - 1]
		let cacheRead = pad(shortNumber(row.cacheRead), widths.cacheRead, true)
		if (previous && row.cacheRead < previous.cacheRead) {
			cacheRead = theme.fg(row.cacheRead < previous.cacheRead * 0.5 ? "error" : "warning", cacheRead)
		}
		return [
			pad(`${row.index}`, widths.index, true),
			pad(row.delta, widths.delta, true),
			pad(row.model, widths.model),
			pad(row.start, widths.start),
			pad(shortNumber(row.fresh), widths.fresh, true),
			"+",
			cacheRead,
			...(showCacheWrite ? ["+", pad(shortNumber(row.cacheWrite), widths.cacheWrite, true)] : []),
			"=",
			pad(shortNumber(row.input), widths.input, true),
			pad(shortNumber(row.output), widths.output, true),
			...(showReasoning ? [pad(shortNumber(numberValue(row.reasoning)), widths.reasoning, true)] : []),
			pad(row.stop, widths.stop),
			row.tools
		].join("  ")
	})
	return [header, ...body].join("\n")
}

function renderStats(data: unknown, theme: Theme) {
	const stats = isRecord(data) ? (data as { rows?: unknown }) : undefined
	const rows = Array.isArray(stats?.rows) ? (stats.rows as LlmStatsRow[]) : []
	const box = new Box(1, 1, value => theme.bg("customMessageBg", value))
	box.addChild(new Text(`${theme.fg("accent", theme.bold("LLM stats"))}\n\n${formatRows(rows, theme)}`, 0, 0))
	return box
}

export function registerLlmStatsCommand(pi: ExtensionAPI) {
	let requestConstraints: Map<string, ToolConstraint> | undefined
	pi.on("before_provider_request", event => {
		requestConstraints = payloadConstraints(event.payload)
	})
	pi.on("message_end", event => {
		if (!isRecord(event.message) || event.message.role !== "assistant") return
		const constraints = requestConstraints
		requestConstraints = undefined
		if (!Array.isArray(event.message.content)) return
		const tools: Record<string, ToolConstraint> = {}
		for (const block of event.message.content) {
			if (!isRecord(block) || block.type !== "toolCall" || typeof block.name !== "string") continue
			const constraint = constraints?.get(block.name.toLowerCase())
			if (constraint) tools[block.name] = constraint
		}
		if (Object.keys(tools).length > 0 && typeof event.message.timestamp === "number") {
			pi.appendEntry(LLM_CALL_CONSTRAINTS_ENTRY_TYPE, {
				assistantTimestamp: event.message.timestamp,
				tools
			} satisfies LlmCallConstraintsData)
		}
	})

	pi.registerEntryRenderer(LLM_STATS_ENTRY_TYPE, (entry, _state, theme) => renderStats(entry.data, theme))

	pi.registerCommand("llm-stats", {
		description: "Show per-call token usage and tool constraints for assistant responses in the current branch.",
		async handler(_args, ctx) {
			await ctx.waitForIdle()
			const branch = ctx.sessionManager.getBranch()
			const constraintsByTimestamp = new Map<number, Record<string, ToolConstraint>>()
			for (const entry of branch) {
				if (entry.type !== "custom" || entry.customType !== LLM_CALL_CONSTRAINTS_ENTRY_TYPE) continue
				const data = constraintsData(entry.data)
				if (data) constraintsByTimestamp.set(data.assistantTimestamp, data.tools)
			}
			let lastAgentTimestamp: number | undefined
			const rows: LlmStatsRow[] = []
			let previousMessage: unknown
			for (const entry of branch) {
				if (entry.type !== "message") continue
				const message = entry.message
				if (!isRecord(message)) continue
				const isAssistant = message.role === "assistant"
				const agentTimestamp = isAssistant ? timestampValue(entry.timestamp) : undefined
				if (!isAssistant || !isRecord(message.usage)) {
					if (isAssistant) lastAgentTimestamp = agentTimestamp
					previousMessage = message
					continue
				}
				const usage = message.usage
				const fresh = numberValue(usage.input)
				const cacheRead = numberValue(usage.cacheRead)
				const cacheWrite = numberValue(usage.cacheWrite)
				const input = fresh + cacheRead + cacheWrite
				const output = numberValue(usage.output)
				rows.push({
					index: rows.length + 1,
					delta: deltaText(agentTimestamp, lastAgentTimestamp),
					model: `${typeof message.provider === "string" ? message.provider : "?"}/${typeof message.model === "string" ? message.model : "?"}`,
					start: callInitiator(previousMessage),
					fresh,
					cacheRead,
					cacheWrite,
					input,
					output,
					reasoning: numberValue(usage.reasoning),
					stop: typeof message.stopReason === "string" ? message.stopReason : "-",
					tools: toolNames(
						message.content,
						typeof message.timestamp === "number" ? constraintsByTimestamp.get(message.timestamp) : undefined
					)
				})
				lastAgentTimestamp = agentTimestamp
				previousMessage = message
			}
			pi.appendEntry(LLM_STATS_ENTRY_TYPE, { rows } satisfies LlmStatsData)
		}
	})
}
