import type { ExtensionAPI, Theme } from "@earendil-works/pi-coding-agent"
import { Box, Text } from "@earendil-works/pi-tui"
import { LLM_STATS_MESSAGE_TYPE } from "./messages"
import { isRecord } from "./schema"

type LlmStatsRow = {
	index: number
	time: string
	model: string
	start: string
	fresh: number
	cacheRead: number
	input: number
	output: number
	stop: string
	tools: string
}

type LlmStatsDetails = {
	rows: LlmStatsRow[]
}

function numberValue(value: unknown): number {
	return typeof value === "number" && Number.isFinite(value) ? value : 0
}

function shortNumber(value: number): string {
	if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(value >= 10_000_000 ? 0 : 1)}m`
	if (value >= 1000) return `${(value / 1000).toFixed(value >= 10_000 ? 0 : 1)}k`
	return `${value}`
}

function timeString(timestamp: unknown): string {
	const date = typeof timestamp === "string" || typeof timestamp === "number" ? new Date(timestamp) : new Date()
	if (Number.isNaN(date.getTime())) return "--:--:--"
	return date.toTimeString().slice(0, 8)
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

function callInitiator(previousMessages: unknown[]): string {
	const last = previousMessages.at(-1)
	if (!isRecord(last)) return "other"
	const lastMessage = last as { role?: unknown }
	if (lastMessage.role === "user") return "user"
	if (lastMessage.role !== "toolResult") return "other"
	return "tools"
}

function pad(value: string, width: number, right = false): string {
	return right ? value.padStart(width) : value.padEnd(width)
}

function formatRows(rows: LlmStatsRow[]): string {
	if (rows.length === 0) return "No assistant messages with usage."
	const widths = {
		index: Math.max(1, `${rows.length}`.length),
		time: 8,
		model: Math.max("model".length, ...rows.map(row => row.model.length)),
		start: Math.max("start".length, ...rows.map(row => row.start.length)),
		fresh: Math.max("fresh".length, ...rows.map(row => shortNumber(row.fresh).length)),
		stop: Math.max("stop".length, ...rows.map(row => row.stop.length)),
		cacheRead: Math.max("cacheR".length, ...rows.map(row => shortNumber(row.cacheRead).length)),
		input: Math.max("input".length, ...rows.map(row => shortNumber(row.input).length)),
		output: Math.max("output".length, ...rows.map(row => shortNumber(row.output).length))
	}
	const header = [
		pad("#", widths.index, true),
		pad("time", widths.time),
		pad("model", widths.model),
		pad("start", widths.start),
		pad("fresh", widths.fresh, true),
		"+",
		pad("cacheR", widths.cacheRead, true),
		"=",
		pad("input", widths.input, true),
		pad("output", widths.output, true),
		pad("stop", widths.stop),
		"tools"
	].join("  ")
	const body = rows.map(row =>
		[
			pad(`${row.index}`, widths.index, true),
			pad(row.time, widths.time),
			pad(row.model, widths.model),
			pad(row.start, widths.start),
			pad(shortNumber(row.fresh), widths.fresh, true),
			"+",
			pad(shortNumber(row.cacheRead), widths.cacheRead, true),
			"=",
			pad(shortNumber(row.input), widths.input, true),
			pad(shortNumber(row.output), widths.output, true),
			pad(row.stop, widths.stop),
			row.tools
		].join("  ")
	)
	return [header, ...body].join("\n")
}

function renderStats(details: unknown, theme: Theme) {
	const stats = isRecord(details) ? (details as { rows?: unknown }) : undefined
	const rows = Array.isArray(stats?.rows) ? (stats.rows as LlmStatsRow[]) : []
	const box = new Box(1, 1, value => theme.bg("customMessageBg", value))
	box.addChild(new Text(`${theme.fg("accent", theme.bold("LLM stats"))}\n\n${formatRows(rows)}`, 0, 0))
	return box
}

export function registerLlmStatsCommand(pi: ExtensionAPI) {
	pi.registerMessageRenderer(LLM_STATS_MESSAGE_TYPE, (message, _state, theme) => renderStats(message.details, theme))

	pi.registerCommand("llm-stats", {
		description: "Show per-call token usage for assistant responses in the current branch.",
		async handler(_args, ctx) {
			await ctx.waitForIdle()
			let index = 1
			const rows: LlmStatsRow[] = []
			const previousMessages: unknown[] = []
			for (const entry of ctx.sessionManager.getBranch()) {
				if (entry.type !== "message") continue
				const message = entry.message
				if (!isRecord(message)) continue
				if (message.role !== "assistant" || !isRecord(message.usage)) {
					previousMessages.push(message)
					continue
				}
				const usage = message.usage
				const fresh = numberValue(usage.input)
				const cacheRead = numberValue(usage.cacheRead)
				const input = fresh + cacheRead
				const output = numberValue(usage.output)
				rows.push({
					index: index++,
					time: timeString(entry.timestamp),
					model: `${typeof message.provider === "string" ? message.provider : "?"}/${typeof message.model === "string" ? message.model : "?"}`,
					start: callInitiator(previousMessages),
					fresh,
					cacheRead,
					input,
					output,
					stop: typeof message.stopReason === "string" ? message.stopReason : "-",
					tools: toolNames(message.content)
				})
				previousMessages.push(message)
			}
			pi.sendMessage({ customType: LLM_STATS_MESSAGE_TYPE, content: "", display: true, details: { rows } satisfies LlmStatsDetails })
		}
	})
}
