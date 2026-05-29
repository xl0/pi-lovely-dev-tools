import { randomUUID } from "node:crypto"
import { writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
	type AgentToolResult,
	convertToPng,
	type ExtensionAPI,
	type ExtensionCommandContext,
	getSettingsListTheme,
	type ToolInfo
} from "@earendil-works/pi-coding-agent"
import type { AutocompleteItem } from "@earendil-works/pi-tui"
import {
	Box,
	Container,
	fuzzyFilter,
	getCapabilities,
	getKeybindings,
	Image,
	Input,
	Spacer,
	Text,
	truncateToWidth,
	visibleWidth
} from "@earendil-works/pi-tui"
import { editToolArgs } from "./arg-editor"
import { type ImageFallback, isRunToolDetails, RUN_TOOL_MESSAGE_TYPE, type RunToolDetails } from "./messages"
import { asSchema, coerceArgValue, formatToolArgs, type Schema } from "./schema"
import { createToolBackend } from "./tool-backend"

async function selectTool(ctx: ExtensionCommandContext, tools: ToolInfo[], activeTools: Set<string>, initialQuery = "") {
	return ctx.ui.custom<ToolInfo | undefined>((_tui, theme, _keybindings, done) => {
		const listTheme = getSettingsListTheme()
		const searchInput = new Input()
		searchInput.setValue(initialQuery)
		searchInput.focused = true
		let filteredTools = initialQuery ? fuzzyFilter(tools, initialQuery, tool => tool.name) : tools
		let selectedIndex = 0

		const applyFilter = () => {
			const query = searchInput.getValue()
			filteredTools = query ? fuzzyFilter(tools, query, tool => tool.name) : tools
			selectedIndex = 0
		}

		return {
			render: (width: number) => {
				const inputLines = searchInput.render(width)
				const lines = [theme.fg("accent", theme.bold("Tool:")), ...(inputLines[0] ? inputLines : []), ""]
				if (filteredTools.length === 0) {
					lines.push(listTheme.hint("  No matching tools"), "", listTheme.hint("  Type to search · Enter select · Esc cancel"))
					return lines
				}

				const maxVisible = Math.min(14, filteredTools.length)
				const startIndex = Math.max(0, Math.min(selectedIndex - Math.floor(maxVisible / 2), filteredTools.length - maxVisible))
				const endIndex = Math.min(startIndex + maxVisible, filteredTools.length)
				for (let index = startIndex; index < endIndex; index++) {
					const tool = filteredTools[index]
					if (!tool) continue
					const isSelected = index === selectedIndex
					const prefix = isSelected ? listTheme.cursor : "  "
					const state = activeTools.has(tool.name) ? "active" : "inactive"
					const name = listTheme.label(tool.name, isSelected)
					const descriptionWidth = Math.max(1, width - visibleWidth(prefix) - visibleWidth(tool.name) - state.length - 8)
					const description = theme.fg("dim", truncateToWidth(tool.description, descriptionWidth, ""))
					lines.push(truncateToWidth(`${prefix}${name} ${theme.fg("dim", `(${state})`)}  ${description}`, width))
				}
				if (startIndex > 0 || endIndex < filteredTools.length)
					lines.push(listTheme.hint(`  (${selectedIndex + 1}/${filteredTools.length})`))
				else lines.push("")
				lines.push("", listTheme.hint("  Type to search · Enter select · Esc cancel"))
				return lines
			},
			invalidate: () => searchInput.invalidate(),
			handleInput: (data: string) => {
				const kb = getKeybindings()
				if (kb.matches(data, "tui.select.up")) {
					if (filteredTools.length === 0) return
					selectedIndex = selectedIndex === 0 ? filteredTools.length - 1 : selectedIndex - 1
				} else if (kb.matches(data, "tui.select.down")) {
					if (filteredTools.length === 0) return
					selectedIndex = selectedIndex === filteredTools.length - 1 ? 0 : selectedIndex + 1
				} else if (kb.matches(data, "tui.select.confirm") || kb.matches(data, "tui.input.submit")) done(filteredTools[selectedIndex])
				else if (kb.matches(data, "tui.select.cancel")) done(undefined)
				else {
					const sanitized = data.replace(/ /g, "")
					if (!sanitized) return
					searchInput.handleInput(sanitized)
					applyFilter()
				}
			}
		}
	})
}

type ToolImageBlock = {
	data: string
	mimeType: string
}

function imageBlock(part: AgentToolResult<unknown>["content"][number]): ToolImageBlock | undefined {
	if (part.type !== "image") return undefined
	const image = part as { data?: string; mimeType?: string; source?: { data?: string; media_type?: string } }
	const data = image.data ?? image.source?.data
	const mimeType = image.mimeType ?? image.source?.media_type
	return data && mimeType ? { data, mimeType } : undefined
}

function imageParts(result: AgentToolResult<unknown>) {
	return result.content.flatMap(part => imageBlock(part) ?? [])
}

function canRenderImage(mimeType: string) {
	const imageCapability = getCapabilities().images
	return !!imageCapability && (imageCapability !== "kitty" || mimeType === "image/png")
}

function imageExtension(mimeType: string) {
	const subtype = mimeType.split("/")[1]?.split(";")[0]?.toLowerCase()
	return subtype && /^[a-z0-9.+-]+$/.test(subtype) ? subtype.replace("jpeg", "jpg") : "bin"
}

async function saveImageFallbacks(result: AgentToolResult<unknown>): Promise<ImageFallback[]> {
	const fallbacks: ImageFallback[] = []
	for (const image of imageParts(result)) {
		if (canRenderImage(image.mimeType)) continue
		const path = join(tmpdir(), `pi-tool-image-${randomUUID()}.${imageExtension(image.mimeType)}`)
		await writeFile(path, Buffer.from(image.data, "base64"))
		fallbacks.push({ mimeType: image.mimeType, path })
	}
	return fallbacks
}

async function convertResultImagesForTerminal(
	result: AgentToolResult<unknown>,
	onConversionFailure?: (mimeType: string) => void
): Promise<AgentToolResult<unknown>> {
	if (getCapabilities().images !== "kitty") return result
	const content = await Promise.all(
		result.content.map(async part => {
			if (part.type !== "image") return part
			const image = part as { data?: string; mimeType?: string; source?: { data?: string; media_type?: string } }
			const data = image.data ?? image.source?.data
			const mimeType = image.mimeType ?? image.source?.media_type
			if (!data || !mimeType || mimeType === "image/png") return part
			const converted = await convertToPng(data, mimeType)
			if (!converted) {
				onConversionFailure?.(mimeType)
				return part
			}
			if (image.data) return { ...part, data: converted.data, mimeType: converted.mimeType }
			return { ...part, source: { ...image.source, data: converted.data, media_type: converted.mimeType } }
		})
	)
	return { ...result, content }
}

function blockText(part: AgentToolResult<unknown>["content"][number]) {
	const { type, ...rest } = part as unknown as { type: string; [key: string]: unknown }
	if (Object.keys(rest).length === 0) return `[${type}]`
	return `[${type}]\n${JSON.stringify(rest, null, 2)}`
}

function resultText(result: AgentToolResult<unknown>, imageFallbacks: ImageFallback[] = []) {
	const remainingFallbacks = [...imageFallbacks]
	return result.content
		.flatMap(part => {
			if (part.type === "text") return [part.text]
			const image = imageBlock(part)
			if (image) {
				if (canRenderImage(image.mimeType)) return []
				const fallbackIndex = remainingFallbacks.findIndex(fallback => fallback.mimeType === image.mimeType)
				const [fallback] = fallbackIndex >= 0 ? remainingFallbacks.splice(fallbackIndex, 1) : []
				return [`[image: ${image.mimeType}${fallback ? ` saved to ${fallback.path}` : ""}]`]
			}
			if (part.type === "image") return ["[image: unknown]"]
			return [blockText(part)]
		})
		.join("\n")
}

function splitCommandArgs(args: string) {
	const parts: string[] = []
	let current = ""
	let quote: string | undefined
	let escaped = false
	for (const char of args) {
		if (escaped) {
			current += char
			escaped = false
		} else if (char === "\\") escaped = true
		else if (quote) {
			if (char === quote) quote = undefined
			else current += char
		} else if (char === '"' || char === "'") quote = char
		else if (/\s/.test(char)) {
			if (current) {
				parts.push(current)
				current = ""
			}
		} else current += char
	}
	if (escaped) current += "\\"
	if (current) parts.push(current)
	return parts
}

function coerceFlatArg(text: string, schema: Schema | undefined): unknown | undefined {
	if (schema?.type === "string") return text
	return coerceArgValue(text, schema)
}

function flatToolArgs(parametersSchema: unknown, values: string[]): Record<string, unknown> | undefined {
	const parameters = asSchema(parametersSchema)
	const properties = asSchema(parameters?.properties)
	if (!properties) return values.length === 0 ? {} : undefined
	const args: Record<string, unknown> = {}
	const entries = Object.entries(properties)
	if (values.length > entries.length) return undefined
	for (let index = 0; index < values.length; index++) {
		const [name, rawSchema] = entries[index] ?? []
		if (!name) return undefined
		const schema = asSchema(rawSchema)
		const value = coerceFlatArg(values[index] ?? "", schema)
		if (value === undefined) return undefined
		args[name] = value
	}
	return args
}

export function registerToolCommand(pi: ExtensionAPI) {
	pi.registerMessageRenderer(RUN_TOOL_MESSAGE_TYPE, (message, _state, theme) => {
		const details = isRunToolDetails(message.details) ? message.details : undefined
		if (!details) {
			const box = new Box(1, 1, value => theme.bg("customMessageBg", value))
			box.addChild(new Text("Tool run", 0, 0))
			return box
		}
		const callLine = `Tool: ${theme.fg("toolTitle", theme.bold(`${details.toolName}(${formatToolArgs(details.toolArgs)})`))}`
		const output = resultText(details.result, details.imageFallbacks)
		const body = output ? `${callLine}\n\n${theme.fg("toolOutput", output)}` : callLine
		const box = new Box(1, 1, value => theme.bg(details.isError ? "toolErrorBg" : "toolSuccessBg", value))
		box.addChild(new Text(body, 0, 0))
		const images = imageParts(details.result).filter(image => canRenderImage(image.mimeType))
		if (images.length === 0) return box
		const container = new Container()
		container.addChild(box)
		for (const image of images) {
			container.addChild(new Spacer(1))
			container.addChild(
				new Image(image.data, image.mimeType, { fallbackColor: value => theme.fg("toolOutput", value) }, { maxWidthCells: 60 })
			)
		}
		return container
	})

	pi.registerCommand("tool", {
		description: "Run a tool. Usage: /tool [tool_name] [flat args...]",
		getArgumentCompletions: (prefix: string): AutocompleteItem[] | null => {
			if (/\s/.test(prefix)) return null
			const tools = [...pi.getAllTools()].sort((a: ToolInfo, b: ToolInfo) => a.name.localeCompare(b.name))
			const filtered = fuzzyFilter(tools, prefix, tool => tool.name)
			if (filtered.length === 0) return null
			return filtered.map(tool => ({ value: `${tool.name} `, label: tool.name, description: tool.description }))
		},
		async handler(args, ctx) {
			if (!ctx.hasUI) {
				ctx.ui.notify("/tool needs interactive UI.", "warning")
				return
			}

			await ctx.waitForIdle()

			const tools = [...pi.getAllTools()].sort((a: ToolInfo, b: ToolInfo) => a.name.localeCompare(b.name))
			if (tools.length === 0) {
				ctx.ui.notify("No tools available.", "warning")
				return
			}

			const activeTools = new Set(pi.getActiveTools())
			const parts = splitCommandArgs(args)
			const initialTool = parts[0] ? tools.find(tool => tool.name === parts[0]) : undefined
			let initialToolQuery = parts[0] && !initialTool ? parts[0] : undefined
			let selectedTool = initialTool
			let initialToolArgs = initialTool && parts.length > 1 ? flatToolArgs(initialTool.parameters, parts.slice(1)) : undefined
			if (initialTool && parts.length > 1 && !initialToolArgs) {
				ctx.ui.notify(`Could not parse flat args for ${initialTool.name}. Opening editor.`, "warning")
			}

			while (true) {
				if (!selectedTool) {
					selectedTool = await selectTool(ctx, tools, activeTools, initialToolQuery)
					initialToolQuery = undefined
				}
				if (!selectedTool) return

				const toolArgs = initialToolArgs ?? (await editToolArgs(ctx.ui, selectedTool))
				initialToolArgs = undefined
				if (!toolArgs) {
					if (initialTool) return
					selectedTool = undefined
					continue
				}

				const toolName = selectedTool.name
				const now = Date.now()
				const toolCallId = `run_tool_${now}`
				let { result, isError } = await ctx.ui.custom<{ result: AgentToolResult<unknown>; isError: boolean }>(
					(tui, theme, keybindings, done) => {
						let backend: Awaited<ReturnType<typeof createToolBackend>> | undefined
						let abortRequested = false
						let doneCalled = false
						let message = "Tool is running... Esc abort"
						let partialResult: AgentToolResult<unknown> | undefined
						const finish = (value: { result: AgentToolResult<unknown>; isError: boolean }) => {
							if (doneCalled) return
							doneCalled = true
							done(value)
						}
						const abortRun = () => {
							if (abortRequested || doneCalled) return
							abortRequested = true
							message = "Aborting Manual Tool Run..."
							backend?.abort()
							tui.requestRender()
						}
						void (async () => {
							try {
								backend = await createToolBackend(ctx, [...activeTools])
								let result = await backend.run(toolName, toolArgs, toolCallId, update => {
									partialResult = update
									tui.requestRender()
								})
								let isError = false
								if (abortRequested || backend.isAborted()) {
									isError = true
									result = { content: [{ type: "text", text: "Manual Tool Run aborted." }], details: undefined }
								}
								finish({ result, isError })
							} catch (error) {
								finish({
									isError: true,
									result: {
										content: [
											{
												type: "text",
												text: abortRequested ? "Manual Tool Run aborted." : error instanceof Error ? error.message : String(error)
											}
										],
										details: undefined
									}
								})
							} finally {
								backend?.dispose()
							}
						})()
						return {
							render: (width: number) => {
								const callLine = theme.fg("toolTitle", theme.bold(`${toolName}(${formatToolArgs(toolArgs)})`))
								const output = partialResult ? resultText(partialResult) : ""
								const body = output ? `${message}\n\n${output}` : message
								const text = new Text(`${callLine}\n${theme.fg("toolOutput", body)}`, 0, 0)
								const box = new Box(1, 1, value => theme.bg("toolPendingBg", value))
								box.addChild(text)
								return box.render(width)
							},
							invalidate: () => {},
							handleInput: (data: string) => {
								if (keybindings.matches(data, "app.interrupt")) abortRun()
							}
						}
					}
				)

				try {
					result = await convertResultImagesForTerminal(result, mimeType => {
						ctx.ui.notify(`Could not convert ${mimeType} image to PNG for terminal display.`, "warning")
					})
				} catch (error) {
					ctx.ui.notify(`Image conversion failed: ${error instanceof Error ? error.message : String(error)}`, "warning")
				}
				let imageFallbacks: ImageFallback[] = []
				try {
					imageFallbacks = await saveImageFallbacks(result)
				} catch (error) {
					ctx.ui.notify(`Could not save image fallback: ${error instanceof Error ? error.message : String(error)}`, "warning")
				}
				pi.sendMessage({
					customType: RUN_TOOL_MESSAGE_TYPE,
					content: resultText(result, imageFallbacks),
					display: true,
					details: { toolName, toolArgs, toolCallId, result, isError, timestamp: Date.now(), imageFallbacks } satisfies RunToolDetails
				})
				return
			}
		}
	})
}
