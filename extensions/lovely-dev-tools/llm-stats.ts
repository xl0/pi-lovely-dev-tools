import type { ExtensionAPI, Theme } from "@earendil-works/pi-coding-agent"
import { Box, Text } from "@earendil-works/pi-tui"
import { LLM_STATS_ENTRY_TYPE } from "./entries"
import { isRecord, numberValue } from "./schema"

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

function toolNames(content: unknown): string {
	if (!Array.isArray(content)) return "-"
	const names = content
		.filter(isRecord)
		.map(block => block as { type?: unknown; name?: unknown })
		.filter(block => block.type === "toolCall" && typeof block.name === "string")
		.map(block => block.name as string)
	return names.length === 0 ? "-" : names.join(",")
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
	pi.registerEntryRenderer(LLM_STATS_ENTRY_TYPE, (entry, _state, theme) => renderStats(entry.data, theme))

	pi.registerCommand("llm-stats", {
		description: "Show per-call token usage for assistant responses in the current branch.",
		async handler(_args, ctx) {
			await ctx.waitForIdle()
			let lastAgentTimestamp: number | undefined
			const rows: LlmStatsRow[] = []
			let previousMessage: unknown
			for (const entry of ctx.sessionManager.getBranch()) {
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
					tools: toolNames(message.content)
				})
				lastAgentTimestamp = agentTimestamp
				previousMessage = message
			}
			pi.appendEntry(LLM_STATS_ENTRY_TYPE, { rows } satisfies LlmStatsData)
		}
	})
}
