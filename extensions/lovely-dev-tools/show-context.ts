import { existsSync, readFileSync } from "node:fs"
import { isAbsolute, relative, resolve } from "node:path"
import { pathToFileURL } from "node:url"
import type { ExtensionAPI, ExtensionCommandContext, Theme } from "@earendil-works/pi-coding-agent"
import {
	buildSessionContext,
	convertToLlm,
	formatSkillsForPrompt,
	parseSkillBlock,
	type SessionEntry
} from "@earendil-works/pi-coding-agent"
import { Box, Text, wrapTextWithAnsi } from "@earendil-works/pi-tui"
import { CONTEXT_READ_MAP_ENTRY_TYPE } from "./entries"
import { isRecord, numberValue } from "./schema"

type EvidenceKind = "startup-context" | "advertised-skill" | "loaded-skill-body" | "tool-read"

type EvidenceRange = {
	startLine: number
	endLine: number
}

type EvidenceSource = {
	kind: EvidenceKind
	range: EvidenceRange
	ordinal: number
	media?: boolean
}

type FileEvidence = {
	path: string
	displayPath: string
	totalLines: number
	missing: boolean
	sources: EvidenceSource[]
	order: number
}

const TOKEN_ROWS = [
	{ id: "system-base", section: "prefix", label: "System prompt · base", unit: "section" },
	{ id: "startup-context", section: "prefix", label: "Startup context files", unit: "file" },
	{ id: "advertised-skills", section: "prefix", label: "Advertised skills", unit: "skill" },
	{ id: "tool-definitions", section: "prefix", label: "Tool definitions", unit: "tool" },
	{ id: "user-messages", section: "messages", label: "User messages", unit: "message" },
	{ id: "loaded-skills", section: "messages", label: "Loaded skill bodies", unit: "skill" },
	{ id: "assistant-text", section: "messages", label: "Assistant text", unit: "block" },
	{ id: "assistant-thinking", section: "messages", label: "Assistant thinking", unit: "block" },
	{ id: "tool-calls", section: "messages", label: "Tool calls", unit: "call" },
	{ id: "tool-results", section: "messages", label: "Tool results", unit: "result" },
	{ id: "compactions", section: "messages", label: "Compactions", unit: "summary" },
	{ id: "branch-summaries", section: "messages", label: "Branch summaries", unit: "summary" },
	{ id: "bash-executions", section: "messages", label: "User shell runs", unit: "run" },
	{ id: "custom-messages", section: "messages", label: "Custom messages", unit: "message" },
	{ id: "media", section: "messages", label: "Images / media", unit: "image" }
] as const

type TokenRowId = (typeof TOKEN_ROWS)[number]["id"]
type TokenSection = (typeof TOKEN_ROWS)[number]["section"]

type TokenBreakdownRow = {
	id: TokenRowId
	section: TokenSection
	label: string
	tokens: number
	count: number
	unit: string
	tools?: ToolTokenBreakdown[]
}

type ToolTokenBreakdown = {
	toolName: string
	tokens: number
	count: number
}

type ContextTokenBreakdown = {
	estimatedTokens: number
	contextWindow: number | null
	piTokens: number | null
	rows: TokenBreakdownRow[]
}

type ContextReadMapData = {
	linesPerCell: number
	tokens?: ContextTokenBreakdown
	files: FileEvidence[]
}

type ReadCall = {
	path: string
	offset?: number
	limit?: number
}

const LINES_PER_CELL = 10
const CHARS_PER_TOKEN = 4
const ESTIMATED_IMAGE_CHARS = 4800
const EMPTY_GLYPH = " "
const BRAILLE_BASE = 0x2800
const LEFT_DOTS_BY_COUNT = [0, 64, 68, 70, 71] as const
const RIGHT_DOTS_BY_COUNT = [0, 128, 160, 176, 184] as const

function normalizePath(cwd: string, path: string) {
	return isAbsolute(path) ? resolve(path) : resolve(cwd, path)
}

function displayPath(cwd: string, path: string) {
	const rel = relative(cwd, path)
	if (rel === "") return "."
	if (!rel.startsWith("..") && !isAbsolute(rel)) return rel
	return path
}

function countLines(text: string) {
	const trimmed = text.replace(/\n+$/, "")
	if (trimmed.length === 0) return 0
	return trimmed.split("\n").length
}

function safeJsonStringify(value: unknown) {
	try {
		return JSON.stringify(value) ?? "undefined"
	} catch {
		return "[unserializable]"
	}
}

function contextFilesPromptSection(contextFiles: Array<{ path: string; content: string }>) {
	if (contextFiles.length === 0) return ""
	let section = "\n\n<project_context>\n\nProject-specific instructions and guidelines:\n\n"
	for (const contextFile of contextFiles) {
		section += `<project_instructions path="${contextFile.path}">\n${contextFile.content}\n</project_instructions>\n\n`
	}
	return `${section}</project_context>\n`
}

function contentSize(content: unknown) {
	if (typeof content === "string") return { textChars: content.length, images: 0 }
	if (!Array.isArray(content)) return { textChars: 0, images: 0 }
	let textChars = 0
	let images = 0
	for (const block of content) {
		if (!isRecord(block)) continue
		const contentBlock = block as { type?: unknown; text?: unknown }
		if (contentBlock.type === "text" && typeof contentBlock.text === "string") textChars += contentBlock.text.length
		if (contentBlock.type === "image") images++
	}
	return { textChars, images }
}

function convertedMessageTextChars(message: unknown) {
	const converted = convertToLlm([message] as Parameters<typeof convertToLlm>[0])
	return converted.reduce((sum, item) => sum + contentSize(item.content).textChars, 0)
}

function addToolTotal(totals: Map<string, { chars: number; count: number }>, toolName: string, chars: number) {
	const total = totals.get(toolName) ?? { chars: 0, count: 0 }
	total.chars += Math.max(0, chars)
	total.count++
	totals.set(toolName, total)
}

function splitToolTotals(totals: Map<string, { chars: number; count: number }>, categoryTokens: number): ToolTokenBreakdown[] {
	const entries = [...totals.entries()].sort((a, b) => b[1].chars - a[1].chars || a[0].localeCompare(b[0]))
	const totalChars = entries.reduce((sum, [, total]) => sum + total.chars, 0)
	let cumulativeChars = 0
	let allocatedTokens = 0
	return entries.map(([toolName, total], index) => {
		cumulativeChars += total.chars
		const boundary =
			totalChars === 0 ? 0 : index === entries.length - 1 ? categoryTokens : Math.round((cumulativeChars / totalChars) * categoryTokens)
		const tokens = Math.max(0, boundary - allocatedTokens)
		allocatedTokens = boundary
		return { toolName, tokens, count: total.count }
	})
}

function collectTokenBreakdown(
	pi: ExtensionAPI,
	ctx: ExtensionCommandContext,
	messages: ReturnType<typeof buildSessionContext>["messages"]
): ContextTokenBreakdown {
	const totals = new Map<TokenRowId, { chars: number; count: number }>()
	const toolCallTotals = new Map<string, { chars: number; count: number }>()
	const toolResultTotals = new Map<string, { chars: number; count: number }>()
	for (const definition of TOKEN_ROWS) totals.set(definition.id, { chars: 0, count: 0 })
	const add = (id: TokenRowId, chars: number, count = 0) => {
		const total = totals.get(id)
		if (!total) return
		total.chars += Math.max(0, chars)
		total.count += count
	}

	const options = ctx.getSystemPromptOptions()
	const systemPrompt = ctx.getSystemPrompt()
	const contextSection = contextFilesPromptSection(options.contextFiles ?? [])
	const skillsSection = formatSkillsForPrompt(options.skills ?? [])
	let baseSystemChars = systemPrompt.length
	if (contextSection && systemPrompt.includes(contextSection)) {
		baseSystemChars -= contextSection.length
		add("startup-context", contextSection.length, options.contextFiles?.length ?? 0)
	}
	if (skillsSection && systemPrompt.includes(skillsSection)) {
		baseSystemChars -= skillsSection.length
		add("advertised-skills", skillsSection.length, (options.skills ?? []).filter(skill => !skill.disableModelInvocation).length)
	}
	add("system-base", baseSystemChars, baseSystemChars > 0 ? 1 : 0)

	const activeTools = new Set(pi.getActiveTools())
	const tools = pi
		.getAllTools()
		.filter(tool => activeTools.has(tool.name))
		.map(tool => ({ name: tool.name, description: tool.description, parameters: tool.parameters }))
	add("tool-definitions", tools.length > 0 ? safeJsonStringify(tools).length : 0, tools.length)

	for (const message of messages) {
		if (!isRecord(message)) continue

		if (message.role === "user") {
			const { textChars, images } = contentSize(message.content)
			const skillBlock = parseSkillBlock(messageText(message))
			if (skillBlock) {
				const userChars = Math.min(textChars, skillBlock.userMessage?.length ?? 0)
				add("loaded-skills", textChars - userChars, 1)
				if (userChars > 0) add("user-messages", userChars, 1)
			} else {
				add("user-messages", textChars, 1)
			}
			add("media", images * ESTIMATED_IMAGE_CHARS, images)
			continue
		}

		if (message.role === "assistant" && Array.isArray(message.content)) {
			let thinkingChars = 0
			let thinkingBlocks = 0
			for (const block of message.content) {
				if (!isRecord(block)) continue
				if (block.type === "text" && typeof block.text === "string") add("assistant-text", block.text.length, 1)
				if (block.type === "thinking" && typeof block.thinking === "string") {
					thinkingChars += block.thinking.length
					thinkingBlocks++
				}
				if (block.type === "toolCall") {
					const toolName = typeof block.name === "string" ? block.name : "unknown"
					const chars = toolName.length + safeJsonStringify(block.arguments).length
					add("tool-calls", chars, 1)
					addToolTotal(toolCallTotals, toolName, chars)
				}
			}
			// Providers with hidden or summarized thinking (GPT reasoning models, Claude with
			// summarized display) replay the full reasoning, not the visible block text.
			// usage.reasoning carries the true token count when reported; max() because the
			// replayed reasoning replaces the visible summary rather than adding to it.
			const reasoningChars = numberValue(isRecord(message.usage) ? message.usage.reasoning : undefined) * CHARS_PER_TOKEN
			const totalThinkingChars = Math.max(thinkingChars, reasoningChars)
			if (totalThinkingChars > 0) add("assistant-thinking", totalThinkingChars, Math.max(thinkingBlocks, 1))
			continue
		}

		if (message.role === "toolResult") {
			const { textChars, images } = contentSize(message.content)
			add("tool-results", textChars, 1)
			addToolTotal(toolResultTotals, typeof message.toolName === "string" ? message.toolName : "unknown", textChars)
			add("media", images * ESTIMATED_IMAGE_CHARS, images)
			continue
		}

		if (message.role === "compactionSummary") {
			add("compactions", convertedMessageTextChars(message), 1)
			continue
		}
		if (message.role === "branchSummary") {
			add("branch-summaries", convertedMessageTextChars(message), 1)
			continue
		}
		if (message.role === "bashExecution" && !message.excludeFromContext) {
			add("bash-executions", convertedMessageTextChars(message), 1)
			continue
		}
		if (message.role === "custom") {
			const { textChars, images } = contentSize(message.content)
			add("custom-messages", textChars, 1)
			add("media", images * ESTIMATED_IMAGE_CHARS, images)
		}
	}

	const rows = TOKEN_ROWS.map(definition => {
		const total = totals.get(definition.id) ?? { chars: 0, count: 0 }
		const tokens = Math.ceil(total.chars / CHARS_PER_TOKEN)
		const tools =
			definition.id === "tool-calls"
				? splitToolTotals(toolCallTotals, tokens)
				: definition.id === "tool-results"
					? splitToolTotals(toolResultTotals, tokens)
					: undefined
		return { ...definition, tokens, count: total.count, ...(tools && tools.length > 0 ? { tools } : {}) }
	})
	const usage = ctx.getContextUsage()
	return {
		estimatedTokens: rows.reduce((sum, row) => sum + row.tokens, 0),
		contextWindow: usage?.contextWindow ?? ctx.model?.contextWindow ?? null,
		piTokens: usage?.tokens ?? null,
		rows
	}
}

function currentLineCount(path: string, fallback: number) {
	if (!existsSync(path)) return { totalLines: Math.max(1, fallback), missing: true }
	return { totalLines: Math.max(1, countLines(readFileSync(path, "utf8"))), missing: false }
}

function getFile(
	files: Map<string, FileEvidence>,
	cwd: string,
	path: string,
	order: number,
	fallbackLines: number,
	totalLinesOverride?: number
) {
	const normalized = normalizePath(cwd, path)
	const existing = files.get(normalized)
	if (existing) return existing
	const { totalLines, missing } =
		totalLinesOverride === undefined
			? currentLineCount(normalized, fallbackLines)
			: { totalLines: Math.max(1, totalLinesOverride), missing: !existsSync(normalized) }
	const file: FileEvidence = {
		path: normalized,
		displayPath: displayPath(cwd, normalized),
		totalLines,
		missing,
		sources: [],
		order
	}
	files.set(normalized, file)
	return file
}

function addEvidence(
	files: Map<string, FileEvidence>,
	cwd: string,
	path: string,
	source: EvidenceSource,
	order: number,
	totalLinesOverride?: number
) {
	const file = getFile(files, cwd, path, order, source.range.endLine, totalLinesOverride)
	file.sources.push(source)
}

function readSkillRanges(path: string) {
	const fallback = { startLine: 1, endLine: 1 }
	if (!existsSync(path)) return { frontmatter: fallback, body: fallback }
	const lines = readFileSync(path, "utf8").split("\n")
	if (lines[0]?.trim() !== "---") {
		return { frontmatter: fallback, body: { startLine: 1, endLine: Math.max(1, lines.length) } }
	}
	const endIndex = lines.findIndex((line, index) => index > 0 && line.trim() === "---")
	const bodyStart = endIndex === -1 ? 1 : Math.min(lines.length, endIndex + 2)
	return {
		frontmatter: { startLine: 1, endLine: endIndex === -1 ? 1 : endIndex + 1 },
		body: { startLine: bodyStart, endLine: Math.max(bodyStart, lines.length) }
	}
}

function messageText(message: unknown) {
	if (!isRecord(message) || !("content" in message)) return ""
	const content = (message as { content?: unknown }).content
	if (typeof content === "string") return content
	if (!Array.isArray(content)) return ""
	return content
		.map(block => {
			if (!isRecord(block)) return ""
			const textBlock = block as { type?: unknown; text?: unknown }
			return textBlock.type === "text" && typeof textBlock.text === "string" ? textBlock.text : ""
		})
		.join("\n")
}

function hasMediaContent(message: unknown) {
	if (!isRecord(message) || !("content" in message)) return false
	const content = (message as { content?: unknown }).content
	return Array.isArray(content) && content.some(block => isRecord(block) && (block as { type?: unknown }).type === "image")
}

function readCallFromBlock(block: unknown): ReadCall | undefined {
	if (!isRecord(block)) return undefined
	const toolCall = block as { type?: unknown; name?: unknown; id?: unknown; arguments?: unknown }
	if (toolCall.type !== "toolCall" || toolCall.name !== "read" || typeof toolCall.id !== "string") return undefined
	const args = isRecord(toolCall.arguments) ? (toolCall.arguments as { path?: unknown; offset?: unknown; limit?: unknown }) : undefined
	if (typeof args?.path !== "string") return undefined
	const call: ReadCall = { path: args.path }
	if (typeof args.offset === "number") call.offset = args.offset
	if (typeof args.limit === "number") call.limit = args.limit
	return call
}

function collectContextReadMap(pi: ExtensionAPI, ctx: ExtensionCommandContext): ContextReadMapData {
	const cwd = ctx.cwd
	const files = new Map<string, FileEvidence>()
	// ordinal = evidence recency; order = first-seen file order for stable groups.
	let ordinal = 0
	let order = 0
	const systemPromptOptions = ctx.getSystemPromptOptions()
	const skillRanges = new Map<string, ReturnType<typeof readSkillRanges>>()
	const getSkillRanges = (path: string) => {
		const cached = skillRanges.get(path)
		if (cached) return cached
		const ranges = readSkillRanges(path)
		skillRanges.set(path, ranges)
		return ranges
	}

	for (const contextFile of systemPromptOptions.contextFiles ?? []) {
		const lineCount = Math.max(1, countLines(contextFile.content))
		addEvidence(
			files,
			cwd,
			contextFile.path,
			{ kind: "startup-context", range: { startLine: 1, endLine: lineCount }, ordinal: ordinal++ },
			order++
		)
	}

	for (const skill of systemPromptOptions.skills ?? []) {
		if (skill.disableModelInvocation) continue
		addEvidence(
			files,
			cwd,
			skill.filePath,
			{ kind: "advertised-skill", range: getSkillRanges(skill.filePath).frontmatter, ordinal: ordinal++ },
			order++
		)
	}

	const readCalls = new Map<string, ReadCall>()
	const messages = buildSessionContext(ctx.sessionManager.getEntries() as SessionEntry[], ctx.sessionManager.getLeafId()).messages
	for (const message of messages) {
		if (!isRecord(message)) continue
		const contextMessage = message as { role?: unknown; content?: unknown; toolName?: unknown; toolCallId?: unknown; isError?: unknown }
		if (contextMessage.role === "assistant" && Array.isArray(contextMessage.content)) {
			for (const block of contextMessage.content) {
				const call = readCallFromBlock(block)
				const id = isRecord(block) ? (block as { id?: unknown }).id : undefined
				if (call && typeof id === "string") readCalls.set(id, call)
			}
		}

		if (
			contextMessage.role === "toolResult" &&
			contextMessage.toolName === "read" &&
			typeof contextMessage.toolCallId === "string" &&
			!contextMessage.isError
		) {
			const call = readCalls.get(contextMessage.toolCallId)
			if (!call) continue
			if (hasMediaContent(message)) {
				addEvidence(
					files,
					cwd,
					call.path,
					{ kind: "tool-read", range: { startLine: 1, endLine: 10 }, ordinal: ordinal++, media: true },
					order++,
					1
				)
				continue
			}
			const startLine = Math.max(1, call.offset ?? 1)
			let lineCount = countLines(messageText(message))
			if (typeof call.limit === "number") lineCount = Math.min(lineCount, call.limit)
			if (lineCount > 0) {
				addEvidence(
					files,
					cwd,
					call.path,
					{ kind: "tool-read", range: { startLine, endLine: startLine + lineCount - 1 }, ordinal: ordinal++ },
					order++
				)
			}
		}

		if (contextMessage.role === "user") {
			const skillBlock = parseSkillBlock(messageText(message))
			if (skillBlock && !skillBlock.location.includes("${")) {
				addEvidence(
					files,
					cwd,
					skillBlock.location,
					{ kind: "loaded-skill-body", range: getSkillRanges(skillBlock.location).body, ordinal: ordinal++ },
					order++
				)
			}
		}
	}

	const sorted = [...files.values()].sort((a, b) => {
		const group = (file: FileEvidence) => {
			if (file.sources.some(source => source.kind === "startup-context")) return 0
			if (file.sources.some(source => source.kind === "advertised-skill")) return 1
			return 2
		}
		const groupDiff = group(a) - group(b)
		if (groupDiff !== 0) return groupDiff
		if (group(a) < 2) return a.order - b.order
		const recentDiff = Math.max(...b.sources.map(source => source.ordinal)) - Math.max(...a.sources.map(source => source.ordinal))
		return recentDiff || a.displayPath.localeCompare(b.displayPath)
	})

	return { linesPerCell: LINES_PER_CELL, tokens: collectTokenBreakdown(pi, ctx, messages), files: sorted }
}

function sourcePriority(kind: EvidenceKind) {
	if (kind === "tool-read") return 3
	if (kind === "loaded-skill-body") return 2
	return 1
}

function colorCell(text: string, kind: EvidenceKind, ordinal: number, maxOrdinal: number, theme: Theme) {
	if (kind === "startup-context" || kind === "advertised-skill") return theme.fg("borderAccent", text)
	if (kind === "loaded-skill-body") return theme.fg("accent", text)
	if (maxOrdinal <= 0) return theme.fg("toolOutput", text)
	const recency = ordinal / maxOrdinal
	if (recency > 0.66) return theme.fg("warning", text)
	if (recency > 0.33) return theme.fg("toolTitle", text)
	return theme.fg("dim", text)
}

function barCell(text: string, theme: Theme) {
	return theme.bg("selectedBg", text)
}

function readCountGlyph(leftCount: number, rightCount: number) {
	if (leftCount === 0 && rightCount === 0) return EMPTY_GLYPH
	const leftDots = LEFT_DOTS_BY_COUNT[Math.min(leftCount, LEFT_DOTS_BY_COUNT.length - 1)] ?? 0
	const rightDots = RIGHT_DOTS_BY_COUNT[Math.min(rightCount, RIGHT_DOTS_BY_COUNT.length - 1)] ?? 0
	return String.fromCodePoint(BRAILLE_BASE + leftDots + rightDots)
}

function renderBarCells(file: FileEvidence, maxOrdinal: number, theme: Theme) {
	const cellCount = Math.max(1, Math.ceil(file.totalLines / LINES_PER_CELL))
	const cells: string[] = []
	for (let index = 0; index < cellCount; index++) {
		const start = index * LINES_PER_CELL + 1
		const middle = Math.min(file.totalLines, start + LINES_PER_CELL / 2 - 1)
		const end = Math.min(file.totalLines, start + LINES_PER_CELL - 1)
		const overlapping = file.sources.filter(source => source.range.startLine <= end && source.range.endLine >= start)
		if (overlapping.length === 0) {
			cells.push(barCell(theme.fg("dim", EMPTY_GLYPH), theme))
			continue
		}
		const mediaCount = overlapping.filter(source => source.media).length
		const leftCount =
			mediaCount + overlapping.filter(source => !source.media && source.range.startLine <= middle && source.range.endLine >= start).length
		const rightCount =
			mediaCount + overlapping.filter(source => !source.media && source.range.startLine <= end && source.range.endLine > middle).length
		const glyph = readCountGlyph(leftCount, rightCount)
		const strongest = overlapping.reduce((best, source) => {
			const priorityDiff = sourcePriority(source.kind) - sourcePriority(best.kind)
			if (priorityDiff !== 0) return priorityDiff > 0 ? source : best
			return source.ordinal > best.ordinal ? source : best
		})
		cells.push(osc8(barCell(colorCell(glyph, strongest.kind, strongest.ordinal, maxOrdinal, theme), theme), fileUrl(file.path, start)))
	}
	return cells
}

function wrapBar(cells: string[], width: number) {
	const cellWidth = Math.max(1, width - 2)
	const lines: string[] = []
	for (let index = 0; index < cells.length; index += cellWidth) {
		const isFirst = index === 0
		const isLast = index + cellWidth >= cells.length
		const prefix = isFirst ? "[" : "↳"
		const suffix = isLast ? "]" : "↴"
		lines.push(`${prefix}${cells.slice(index, index + cellWidth).join("")}${suffix}`)
	}
	return lines.length === 0 ? ["[]"] : lines
}

function truncatePath(path: string, width: number) {
	if (path.length <= width) return path
	if (width <= 5) return path.slice(0, width)
	const marker = "…/…"
	const available = width - marker.length
	const head = Math.ceil(available / 2)
	const tail = available - head
	return `${path.slice(0, head)}${marker}${path.slice(path.length - tail)}`
}

function truncateLabel(label: string, width: number) {
	if (label.length <= width) return label
	if (width <= 1) return label.slice(0, width)
	return `${label.slice(0, width - 1)}…`
}

function osc8(text: string, url: string) {
	return `\x1b]8;;${url}\x1b\\${text}\x1b]8;;\x1b\\`
}

function fileUrl(path: string, startLine?: number, endLine?: number) {
	const { TERM_PROGRAM } = process.env
	if (TERM_PROGRAM === "vscode" && startLine !== undefined) return `vscode://file${path}:${startLine}:1`
	const lineFragment =
		startLine === undefined ? "" : `#L${startLine}${endLine === undefined || endLine === startLine ? "" : `-L${endLine}`}`
	return `${pathToFileURL(path).href}${lineFragment}`
}

function shortTokenCount(value: number) {
	if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(value >= 10_000_000 ? 0 : 1)}m`
	if (value >= 1000) return `${(value / 1000).toFixed(value >= 10_000 ? 0 : 1)}k`
	return `${value}`
}

function tokenRowColor(id: TokenRowId, text: string, theme: Theme) {
	if (id === "system-base") return theme.fg("borderAccent", text)
	if (id === "startup-context") return theme.fg("accent", text)
	if (id === "advertised-skills") return theme.fg("warning", text)
	if (id === "tool-definitions") return theme.fg("toolTitle", text)
	if (id === "user-messages") return theme.fg("success", text)
	if (id === "loaded-skills") return theme.fg("mdLink", text)
	if (id === "assistant-text") return theme.fg("toolOutput", text)
	if (id === "assistant-thinking") return theme.fg("muted", text)
	if (id === "tool-calls") return theme.fg("syntaxFunction", text)
	if (id === "tool-results") return theme.fg("syntaxString", text)
	if (id === "compactions") return theme.fg("error", text)
	if (id === "branch-summaries") return theme.fg("syntaxType", text)
	if (id === "bash-executions") return theme.fg("bashMode", text)
	if (id === "custom-messages") return theme.fg("customMessageLabel", text)
	return theme.fg("mdLinkUrl", text)
}

function cumulativeTokenBar(rows: TokenBreakdownRow[], capacity: number, width: number, theme: Theme) {
	if (width <= 0) return ""
	if (capacity === 0) return theme.fg("dim", "░".repeat(width))
	let cumulativeTokens = 0
	let usedCells = 0
	const segments = rows
		.map(row => {
			cumulativeTokens += row.tokens
			const boundary = Math.min(width, Math.round((cumulativeTokens / capacity) * width))
			const cells = Math.max(0, boundary - usedCells)
			usedCells = boundary
			return tokenRowColor(row.id, "█".repeat(cells), theme)
		})
		.join("")
	return `${segments}${theme.fg("dim", "░".repeat(Math.max(0, width - usedCells)))}`
}

function countLabel(row: TokenBreakdownRow) {
	if (row.count === 0) return "-"
	return `${row.count} ${row.unit}${row.count === 1 ? "" : "s"}`
}

function toolCountLabel(tool: ToolTokenBreakdown, unit: string) {
	return `${tool.count} ${unit}${tool.count === 1 ? "" : "s"}`
}

function renderTokenBreakdown(tokens: ContextTokenBreakdown, width: number, theme: Theme) {
	const estimatedPercent = tokens.contextWindow ? (tokens.estimatedTokens / tokens.contextWindow) * 100 : undefined
	const piPercent = tokens.contextWindow && tokens.piTokens !== null ? (tokens.piTokens / tokens.contextWindow) * 100 : undefined
	const capacity = tokens.contextWindow ? ` / ${shortTokenCount(tokens.contextWindow)} (${estimatedPercent?.toFixed(1)}%)` : ""
	const meter =
		tokens.piTokens === null
			? "Pi meter unavailable"
			: `Pi meter ${shortTokenCount(tokens.piTokens)}${piPercent === undefined ? "" : ` (${piPercent.toFixed(1)}%)`}`
	const bar = cumulativeTokenBar(tokens.rows, tokens.contextWindow ?? tokens.estimatedTokens, Math.max(1, width - 2), theme)
	const lines = [
		...wrapTextWithAnsi(
			`${theme.fg("accent", theme.bold("Context token breakdown"))}  ≈${shortTokenCount(tokens.estimatedTokens)}${capacity} · ${meter}`,
			width
		),
		...wrapTextWithAnsi(theme.fg("dim", "Estimated as chars ÷ 4 · each image ≈1.2k · provider framing/tokenizer overhead excluded"), width),
		width > 2 ? `[${bar}]` : bar,
		""
	]
	for (const section of ["prefix", "messages"] as const) {
		const rows = tokens.rows.filter(row => row.section === section)
		const sectionTokens = rows.reduce((sum, row) => sum + row.tokens, 0)
		lines.push(
			`${theme.bold(section === "prefix" ? "Prompt prefix" : "Effective messages")} ${theme.fg("dim", `≈${shortTokenCount(sectionTokens)}`)}`
		)
		if (width >= 76) {
			const labelWidth = 23
			const tokenWidth = 7
			const percentWidth = 6
			const countWidth = 13
			for (const row of rows) {
				const percent = tokens.estimatedTokens === 0 ? 0 : (row.tokens / tokens.estimatedTokens) * 100
				const label = row.label.padEnd(labelWidth)
				const amount = `≈${shortTokenCount(row.tokens)}`.padStart(tokenWidth)
				const share = `${percent.toFixed(1)}%`.padStart(percentWidth)
				const count = countLabel(row).padStart(countWidth)
				lines.push(`  ${tokenRowColor(row.id, "■", theme)} ${label} ${amount} ${share} ${theme.fg("dim", count)}`)
				const tools = row.tools ?? []
				for (const [toolIndex, tool] of tools.entries()) {
					const toolLabel = truncateLabel(tool.toolName, labelWidth - 4).padEnd(labelWidth - 4)
					const toolAmount = `≈${shortTokenCount(tool.tokens)}`.padStart(tokenWidth)
					const toolPercent = tokens.estimatedTokens === 0 ? 0 : (tool.tokens / tokens.estimatedTokens) * 100
					const toolShare = `${toolPercent.toFixed(1)}%`.padStart(percentWidth)
					const toolCount = toolCountLabel(tool, row.unit).padStart(countWidth)
					const branch = toolIndex === tools.length - 1 ? "└──" : "├──"
					lines.push(`    ${branch} ${toolLabel} ${theme.fg("dim", `${toolAmount} ${toolShare} ${toolCount}`)}`)
				}
			}
		} else {
			for (const row of rows) {
				const percent = tokens.estimatedTokens === 0 ? 0 : (row.tokens / tokens.estimatedTokens) * 100
				const stats = `≈${shortTokenCount(row.tokens)} · ${percent.toFixed(1)}% · ${countLabel(row)}`
				lines.push(...wrapTextWithAnsi(`  ${tokenRowColor(row.id, "■", theme)} ${row.label}  ${theme.fg("dim", stats)}`, width))
				const tools = row.tools ?? []
				for (const [toolIndex, tool] of tools.entries()) {
					const toolPercent = tokens.estimatedTokens === 0 ? 0 : (tool.tokens / tokens.estimatedTokens) * 100
					const toolStats = `≈${shortTokenCount(tool.tokens)} · ${toolPercent.toFixed(1)}% · ${toolCountLabel(tool, row.unit)}`
					const branch = toolIndex === tools.length - 1 ? "└──" : "├──"
					lines.push(...wrapTextWithAnsi(`    ${branch} ${tool.toolName}  ${theme.fg("dim", toolStats)}`, width))
				}
			}
		}
		lines.push("")
	}
	return lines
}

function renderSnapshot(details: ContextReadMapData, width: number, theme: Theme) {
	const tokenLines = details.tokens ? renderTokenBreakdown(details.tokens, width, theme) : []
	if (details.files.length === 0) return [...tokenLines, "No file-backed context evidence."].join("\n")
	const maxOrdinal = Math.max(0, ...details.files.flatMap(file => file.sources.map(source => source.ordinal)))
	const wide = width >= 100
	const pathWidth = 50
	const lines = [
		...tokenLines,
		`${theme.fg("accent", theme.bold("Context read map"))} ${`One cell = ${details.linesPerCell} lines · ${details.files.length} files total`}`,
		`${theme.fg("dim", "Read count:")}  ${theme.fg("dim", "⣀")} 1  ${theme.fg("dim", "⣤")} 2  ${theme.fg("dim", "⣶")} 3  ${theme.fg("dim", "⣿")} 4+`,
		`${theme.fg("dim", "Type:")} ${theme.fg("borderAccent", "system prompt")}  ${theme.fg("accent", "skill loaded")} Read tool: [ ${theme.fg("warning", "recent")} / ${theme.fg("toolTitle", "mid")} / ${theme.fg("dim", "old")} ]`,
		""
	]
	for (const file of details.files) {
		const cells = renderBarCells(file, maxOrdinal, theme)
		if (wide) {
			const displayName = truncatePath(file.displayPath, pathWidth)
			const padding = " ".repeat(Math.max(0, pathWidth - displayName.length))
			const linkedName = `${padding}${osc8(displayName, fileUrl(file.path))}`
			const name = file.missing ? theme.fg("warning", linkedName) : linkedName
			const wrapped = wrapBar(cells, Math.max(10, width - pathWidth - 3))
			lines.push(`${name} ${wrapped[0]}`)
			for (const chunk of wrapped.slice(1)) lines.push(`${"".padEnd(pathWidth)} ${chunk}`)
		} else {
			const displayName = truncatePath(file.displayPath, Math.max(10, width - 2))
			const linkedName = osc8(displayName, fileUrl(file.path))
			const name = file.missing ? theme.fg("warning", linkedName) : linkedName
			lines.push(name)
			for (const chunk of wrapBar(cells, Math.max(10, width - 2))) lines.push(chunk)
		}
	}
	return lines.join("\n")
}

function isContextReadMapData(value: unknown): value is ContextReadMapData {
	if (!isRecord(value)) return false
	const details = value as { files?: unknown; linesPerCell?: unknown }
	return Array.isArray(details.files) && typeof details.linesPerCell === "number"
}

export function registerShowContextCommand(pi: ExtensionAPI) {
	pi.registerEntryRenderer<ContextReadMapData>(CONTEXT_READ_MAP_ENTRY_TYPE, (entry, _options, theme) => {
		const details = isContextReadMapData(entry.data) ? entry.data : undefined
		const box = new Box(1, 1)
		if (details) {
			box.addChild({
				render: width => renderSnapshot(details, width, theme).split("\n"),
				invalidate() {}
			})
		} else {
			box.addChild(new Text("Invalid context read map.", 0, 0))
		}
		return box
	})

	pi.registerCommand("show-context", {
		description: "Show token and file coverage breakdowns for the current model context.",
		async handler(_args, ctx) {
			await ctx.waitForIdle()
			const details = collectContextReadMap(pi, ctx)
			pi.appendEntry(CONTEXT_READ_MAP_ENTRY_TYPE, details)
		}
	})
}
