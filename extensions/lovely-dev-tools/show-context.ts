import { existsSync, readFileSync } from "node:fs"
import { isAbsolute, relative, resolve } from "node:path"
import { pathToFileURL } from "node:url"
import type { ExtensionAPI, ExtensionCommandContext, Theme } from "@earendil-works/pi-coding-agent"
import { buildSessionContext, parseSkillBlock, type SessionEntry } from "@earendil-works/pi-coding-agent"
import { Box, Text } from "@earendil-works/pi-tui"
import { CONTEXT_READ_MAP_MESSAGE_TYPE } from "./messages"
import { isRecord } from "./schema"

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

type ContextReadMapDetails = {
	cwd: string
	createdAt: number
	linesPerCell: number
	files: FileEvidence[]
}

type ReadCall = {
	path: string
	offset?: number
	limit?: number
}

const LINES_PER_CELL = 10
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

function frontmatterRange(path: string): EvidenceRange {
	if (!existsSync(path)) return { startLine: 1, endLine: 1 }
	const text = readFileSync(path, "utf8")
	const lines = text.split("\n")
	if (lines[0]?.trim() !== "---") return { startLine: 1, endLine: 1 }
	const endIndex = lines.findIndex((line, index) => index > 0 && line.trim() === "---")
	return { startLine: 1, endLine: endIndex === -1 ? 1 : endIndex + 1 }
}

function bodyRange(path: string): EvidenceRange {
	if (!existsSync(path)) return { startLine: 1, endLine: 1 }
	const text = readFileSync(path, "utf8")
	const lines = text.split("\n")
	if (lines[0]?.trim() !== "---") return { startLine: 1, endLine: Math.max(1, lines.length) }
	const endIndex = lines.findIndex((line, index) => index > 0 && line.trim() === "---")
	const startLine = endIndex === -1 ? 1 : Math.min(lines.length, endIndex + 2)
	return { startLine, endLine: Math.max(startLine, lines.length) }
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

function collectContextReadMap(ctx: ExtensionCommandContext): ContextReadMapDetails {
	const cwd = ctx.cwd
	const files = new Map<string, FileEvidence>()
	// ordinal = evidence recency; order = first-seen file order for stable groups.
	let ordinal = 0
	let order = 0
	const systemPromptOptions = ctx.getSystemPromptOptions()

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
			{ kind: "advertised-skill", range: frontmatterRange(skill.filePath), ordinal: ordinal++ },
			order++
		)
	}

	const readCalls = new Map<string, ReadCall>()
	const context = buildSessionContext(ctx.sessionManager.getEntries() as SessionEntry[], ctx.sessionManager.getLeafId())
	for (const message of context.messages) {
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
					{ kind: "loaded-skill-body", range: bodyRange(skillBlock.location), ordinal: ordinal++ },
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

	return { cwd, createdAt: Date.now(), linesPerCell: LINES_PER_CELL, files: sorted }
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

function renderSnapshot(details: ContextReadMapDetails, width: number, theme: Theme) {
	if (details.files.length === 0) return "No file-backed context evidence."
	const maxOrdinal = Math.max(0, ...details.files.flatMap(file => file.sources.map(source => source.ordinal)))
	const wide = width >= 150
	const pathWidth = 50
	const lines = [
		`${theme.fg("accent", theme.bold("Context read map"))} ${`One cell = ${details.linesPerCell} lines · ${details.files.length} files total`}`,
		`${theme.fg("dim", "Read count:")}  ${theme.fg("dim", "⣀")} 1  ${theme.fg("dim", "⣤")} 2  ${theme.fg("dim", "⣶")} 3  ${theme.fg("dim", "⣿")} 4+`,
		`${theme.fg("dim", "Type:")} ${theme.fg("borderAccent", "system prompt")}  ${theme.fg("accent", "skill loaded")} Read tool: [ ${theme.fg("warning", "recent")} / ${theme.fg("toolTitle", "mid")} / ${theme.fg("dim", "old")} ]`,
		""
	]
	for (const file of details.files) {
		const displayName = truncatePath(file.displayPath, pathWidth)
		const padding = " ".repeat(Math.max(0, pathWidth - displayName.length))
		const linkedName = `${padding}${osc8(displayName, fileUrl(file.path))}`
		const name = file.missing ? theme.fg("warning", linkedName) : linkedName
		const cells = renderBarCells(file, maxOrdinal, theme)
		if (wide) {
			const wrapped = wrapBar(cells, Math.max(10, width - pathWidth - 3))
			lines.push(`${name} ${wrapped[0]}`)
			for (const chunk of wrapped.slice(1)) lines.push(`${"".padEnd(pathWidth)} ${chunk}`)
		} else {
			lines.push(name)
			for (const chunk of wrapBar(cells, Math.max(10, width - 2))) lines.push(`  ${chunk}`)
		}
	}
	return lines.join("\n")
}

function isContextReadMapDetails(value: unknown): value is ContextReadMapDetails {
	if (!isRecord(value)) return false
	const details = value as { files?: unknown; cwd?: unknown; createdAt?: unknown }
	return Array.isArray(details.files) && typeof details.cwd === "string" && typeof details.createdAt === "number"
}

export function registerShowContextCommand(pi: ExtensionAPI) {
	pi.registerMessageRenderer<ContextReadMapDetails>(CONTEXT_READ_MAP_MESSAGE_TYPE, (message, _options, theme) => {
		const details = isContextReadMapDetails(message.details) ? message.details : undefined
		const width = process.stdout.columns || 120
		const text = details
			? renderSnapshot(details, width, theme)
			: typeof message.content === "string"
				? message.content
				: "Invalid context read map."
		const box = new Box(1, 1)
		box.addChild(new Text(text, 0, 0))
		return box
	})

	pi.registerCommand("show-context", {
		description: "Show a file coverage map for the current model context.",
		async handler(_args, ctx) {
			await ctx.waitForIdle()
			const details = collectContextReadMap(ctx)
			pi.sendMessage({ customType: CONTEXT_READ_MAP_MESSAGE_TYPE, content: "Context read map", display: true, details })
		}
	})
}
