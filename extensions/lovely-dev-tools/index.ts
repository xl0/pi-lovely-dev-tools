import {
	type AgentToolResult,
	type ExtensionAPI,
	type ExtensionCommandContext,
	getSettingsListTheme
} from "@earendil-works/pi-coding-agent"
import { Box, getKeybindings, Input, Text, truncateToWidth, visibleWidth } from "@earendil-works/pi-tui"

const RUN_TOOL_CALL_MESSAGE_TYPE = "lovely-dev-tools.run-tool.call"
const RUN_TOOL_RESULT_MESSAGE_TYPE = "lovely-dev-tools.run-tool.result"
const OMIT = Symbol("omit")
const OMIT_LABEL = "<omit>"

type ToolInfo = ReturnType<ExtensionAPI["getAllTools"]>[number]
type Schema = Record<string, unknown> & {
	enum?: unknown
	anyOf?: unknown
	oneOf?: unknown
	const?: unknown
	items?: unknown
	type?: unknown
	description?: unknown
	default?: unknown
	properties?: unknown
	required?: unknown
}
type ArgValue = unknown | typeof OMIT

type RunToolCallDetails = {
	toolName: string
	toolArgs: Record<string, unknown>
	toolCallId: string
	timestamp: number
}

type RunToolResultDetails = {
	toolName: string
	toolCallId: string
	result: AgentToolResult<unknown>
	isError: boolean
	timestamp: number
}

type ArgField = {
	path: string[]
	label: string
	schema: Schema | undefined
	required: boolean
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === "object" && !Array.isArray(value)
}

function asSchema(value: unknown): Schema | undefined {
	return isRecord(value) ? value : undefined
}

function parseJsonValue(value: string): unknown | undefined {
	try {
		return JSON.parse(value)
	} catch {
		return undefined
	}
}

function isRunToolCallDetails(value: unknown): value is RunToolCallDetails {
	if (!isRecord(value)) return false
	const details = value as Partial<RunToolCallDetails>
	return (
		typeof details.toolName === "string" &&
		isRecord(details.toolArgs) &&
		typeof details.toolCallId === "string" &&
		typeof details.timestamp === "number"
	)
}

function isRunToolResultDetails(value: unknown): value is RunToolResultDetails {
	if (!isRecord(value)) return false
	const details = value as Partial<RunToolResultDetails>
	return (
		typeof details.toolName === "string" &&
		typeof details.toolCallId === "string" &&
		isRecord(details.result) &&
		typeof details.isError === "boolean" &&
		typeof details.timestamp === "number"
	)
}

function toolLabel(tool: ToolInfo, activeTools: Set<string>) {
	const active = activeTools.has(tool.name) ? "active" : "inactive"
	return `${tool.name} (${active}) - ${tool.description}`
}

function schemaStringArray(value: unknown): string[] | undefined {
	return Array.isArray(value) && value.every(item => typeof item === "string") ? value : undefined
}

function schemaArray(value: unknown): Schema[] | undefined {
	return Array.isArray(value) && value.every(isRecord) ? (value as Schema[]) : undefined
}

function schemaEnum(schema: Schema): unknown[] | undefined {
	const ownEnum = Array.isArray(schema.enum) ? schema.enum : undefined
	if (ownEnum) return ownEnum
	const variants = schemaArray(schema.anyOf) ?? schemaArray(schema.oneOf)
	const values = variants?.map(variant => variant.const)
	return values?.every(value => value !== undefined) ? values : undefined
}

function schemaType(schema: Schema | undefined): string {
	if (!schema) return "any"
	if ("const" in schema) return JSON.stringify(schema.const)
	const enumValues = schemaEnum(schema)
	if (enumValues) return enumValues.map(value => JSON.stringify(value)).join(" | ")
	const variants = schemaArray(schema.anyOf) ?? schemaArray(schema.oneOf)
	if (variants) return variants.map(schemaType).join(" | ")
	const items = asSchema(schema.items)
	if (items) return `${schemaType(items)}[]`
	const type = schema.type
	if (Array.isArray(type)) return type.join(" | ")
	return typeof type === "string" ? type : "any"
}

function schemaDescription(schema: Schema | undefined) {
	return typeof schema?.description === "string" ? schema.description : undefined
}

function schemaDefault(schema: Schema | undefined): ArgValue {
	if (!schema) return OMIT
	if ("default" in schema) return schema.default
	if ("const" in schema) return schema.const
	return OMIT
}

function valueLabel(value: ArgValue) {
	return value === OMIT ? OMIT_LABEL : JSON.stringify(value)
}

function inputValue(value: ArgValue, schema: Schema | undefined) {
	if (value === OMIT) return ""
	return schema?.type === "string" && typeof value === "string" ? value : valueLabel(value)
}

function coerceValue(text: string, schema: Schema | undefined): ArgValue | undefined {
	const type = schema?.type
	if (type === "string") return text
	if (type === "number" || type === "integer") {
		if (text.trim() === "") return undefined
		const value = Number(text.trim())
		if (!Number.isFinite(value) || (type === "integer" && !Number.isInteger(value))) return undefined
		return value
	}
	const parsed = parseJsonValue(text.trim() || "null")
	if (parsed === undefined) return undefined
	if (type === "array" && !Array.isArray(parsed)) return undefined
	if (type === "object" && !isRecord(parsed)) return undefined
	return parsed
}

function flattenFields(schema: Schema | undefined, path: string[] = [], depth = 0): ArgField[] {
	const properties = schema ? asSchema(schema.properties) : undefined
	if (!properties) return []
	const required = new Set(schemaStringArray(schema?.required) ?? [])
	const fields: ArgField[] = []
	for (const [name, rawSchema] of Object.entries(properties)) {
		const propertySchema = asSchema(rawSchema)
		const propertyPath = [...path, name]
		const nested = propertySchema?.type === "object" && asSchema(propertySchema.properties)
		if (nested) {
			fields.push(...flattenFields(propertySchema, propertyPath, depth + 1))
			continue
		}
		fields.push({
			path: propertyPath,
			label: `${"  ".repeat(depth)}${name}`,
			schema: propertySchema,
			required: required.has(name)
		})
	}
	return fields
}

function setNested(target: Record<string, unknown>, path: string[], value: unknown) {
	let current = target
	for (const key of path.slice(0, -1)) {
		const next = current[key]
		if (isRecord(next)) current = next
		else {
			const created: Record<string, unknown> = {}
			current[key] = created
			current = created
		}
	}
	const last = path.at(-1)
	if (last) current[last] = value
}

function buildArgs(fields: ArgField[], values: Map<string, ArgValue>, included: Set<string>) {
	const args: Record<string, unknown> = {}
	for (const field of fields) {
		const id = field.path.join(".")
		const value = values.get(id)
		if (included.has(id) && value !== undefined && value !== OMIT) setNested(args, field.path, value)
	}
	return args
}

async function editToolArgs(ctx: ExtensionCommandContext, tool: ToolInfo): Promise<Record<string, unknown> | undefined> {
	const parameters = asSchema(tool.parameters)
	const fields = flattenFields(parameters)
	if (fields.length === 0) return {}

	const values = new Map<string, ArgValue>()
	for (const field of fields) values.set(field.path.join("."), field.required ? schemaDefault(field.schema) : OMIT)

	return ctx.ui.custom<Record<string, unknown> | undefined>((_tui, theme, _keybindings, done) => {
		const listTheme = getSettingsListTheme()
		let selectedIndex = 0
		let focusPart: "include" | "value" = "include"
		let activeInput: Input | undefined
		const included = new Set(fields.filter(field => field.required).map(field => field.path.join(".")))
		const maxVisible = Math.min(fields.length, 14)

		const fieldId = (field: ArgField) => field.path.join(".")
		const fieldChoices = (field: ArgField) => {
			const enumValues = field.schema ? schemaEnum(field.schema) : undefined
			const choices = enumValues?.map(value => JSON.stringify(value)) ?? (field.schema?.type === "boolean" ? ["true", "false"] : undefined)
			return choices && !field.required ? [OMIT_LABEL, ...choices] : choices
		}
		const setValueFromLabel = (field: ArgField, label: string) => {
			const id = fieldId(field)
			if (label === OMIT_LABEL) values.set(id, OMIT)
			else if (field.schema?.type === "boolean") values.set(id, label === "true")
			else {
				const parsed = parseJsonValue(label)
				values.set(id, parsed === undefined ? label : parsed)
			}
		}
		const inputCursor = (input: Input) => (input as unknown as { cursor: number }).cursor
		const setInputCursor = (input: Input, cursor: number) => {
			;(input as unknown as { cursor: number }).cursor = cursor
		}
		const selectedFieldIncluded = () => {
			const field = fields[selectedIndex]
			return !!field && (field.required || included.has(fieldId(field)))
		}
		const updateFocus = () => {
			focusPart = selectedFieldIncluded() ? "value" : "include"
		}
		const renderInput = (input: Input, width: number) => input.render(width + 2)[0]?.slice(2) ?? ""
		const updateActiveInput = () => {
			const field = fields[selectedIndex]
			if (!field || fieldChoices(field)) {
				activeInput = undefined
				return
			}
			const input = new Input()
			input.setValue(inputValue(values.get(fieldId(field)) ?? OMIT, field.schema))
			setInputCursor(input, input.getValue().length)
			input.focused = true
			activeInput = input
		}
		const commitActiveInput = () => {
			const field = fields[selectedIndex]
			if (!field || !activeInput || !selectedFieldIncluded()) return true
			const id = fieldId(field)
			const value = activeInput.getValue()
			const coerced = coerceValue(value, field.schema)
			if (coerced === undefined) {
				ctx.ui.notify(`${id} must match ${schemaType(field.schema)}.`, "error")
				return false
			}
			values.set(id, coerced)
			return true
		}
		const handleActiveInput = (data: string) => {
			activeInput?.handleInput(data)
		}
		const toggleInclude = () => {
			const field = fields[selectedIndex]
			if (!field || field.required) return
			const id = fieldId(field)
			if (included.has(id)) {
				included.delete(id)
				values.set(id, OMIT)
				focusPart = "include"
				updateActiveInput()
				return
			}
			included.add(id)
			const choices = fieldChoices(field)?.filter(choice => choice !== OMIT_LABEL)
			if (choices?.[0]) setValueFromLabel(field, choices[0])
			focusPart = "value"
		}
		updateActiveInput()
		updateFocus()

		return {
			render: (width: number) => {
				const lines: string[] = [
					theme.fg("accent", theme.bold(`Arguments for ${tool.name}`)),
					theme.fg("dim", "Enter run · Esc back · ←/→ switch include/value · type to edit · ↑/↓ commit+move"),
					""
				]
				const startIndex = Math.max(0, Math.min(selectedIndex - Math.floor(maxVisible / 2), fields.length - maxVisible))
				const endIndex = Math.min(startIndex + maxVisible, fields.length)
				const maxLabelWidth = Math.min(30, Math.max(...fields.map(field => visibleWidth(field.label))))
				for (let index = startIndex; index < endIndex; index++) {
					const field = fields[index]
					if (!field) continue
					const id = fieldId(field)
					const isSelected = index === selectedIndex
					const prefix = isSelected ? listTheme.cursor : "  "
					const isIncluded = field.required || included.has(id)
					const checkboxText = `${isIncluded ? "[x]" : "[ ]"} `
					const checkboxSelected = isSelected && focusPart === "include"
					const checkbox = field.required ? theme.fg("dim", checkboxText) : listTheme.label(checkboxText, checkboxSelected)
					const label = listTheme.label(field.label + " ".repeat(Math.max(0, maxLabelWidth - visibleWidth(field.label))), isSelected)
					const valueWidth = Math.max(1, width - visibleWidth(prefix) - visibleWidth(checkboxText) - maxLabelWidth - 6)
					const rawValue =
						activeInput && index === selectedIndex && isIncluded
							? focusPart === "value"
								? renderInput(activeInput, valueWidth)
								: activeInput.getValue()
							: valueLabel(values.get(id) ?? OMIT)
					const valueSelected = isSelected && focusPart === "value"
					const value = listTheme.value(truncateToWidth(rawValue, valueWidth, ""), valueSelected)
					lines.push(truncateToWidth(`${prefix}${checkbox}${label}  ${value}`, width))
				}
				if (startIndex > 0 || endIndex < fields.length) lines.push(listTheme.hint(`  (${selectedIndex + 1}/${fields.length})`))
				const selected = fields[selectedIndex]
				if (selected) {
					lines.push("")
					lines.push(
						listTheme.description(
							`  ${selected.required ? "required" : "optional"} ${schemaType(selected.schema)}${schemaDescription(selected.schema) ? ` - ${schemaDescription(selected.schema)}` : ""}`
						)
					)
				}
				return lines
			},
			invalidate: () => activeInput?.invalidate(),
			handleInput: (data: string) => {
				const kb = getKeybindings()
				if (kb.matches(data, "tui.input.submit")) {
					if (commitActiveInput()) done(buildArgs(fields, values, included))
				} else if (kb.matches(data, "tui.select.up")) {
					if (!commitActiveInput()) return
					selectedIndex = selectedIndex === 0 ? fields.length - 1 : selectedIndex - 1
					updateActiveInput()
					updateFocus()
				} else if (kb.matches(data, "tui.select.down")) {
					if (!commitActiveInput()) return
					selectedIndex = selectedIndex === fields.length - 1 ? 0 : selectedIndex + 1
					updateActiveInput()
					updateFocus()
				} else if (kb.matches(data, "tui.editor.cursorRight")) {
					if (focusPart === "include" && selectedFieldIncluded()) focusPart = "value"
					else if (focusPart === "value") handleActiveInput(data)
				} else if (kb.matches(data, "tui.editor.cursorLeft")) {
					if (focusPart === "value" && (!activeInput || inputCursor(activeInput) === 0)) focusPart = "include"
					else if (focusPart === "value") handleActiveInput(data)
				} else if (data === " ") {
					const field = fields[selectedIndex]
					if (!field) return
					const choices = fieldChoices(field)
					if (focusPart === "include") toggleInclude()
					else if (choices) {
						const current = valueLabel(values.get(fieldId(field)) ?? OMIT)
						setValueFromLabel(field, choices[(choices.indexOf(current) + 1) % choices.length] ?? choices[0] ?? OMIT_LABEL)
					} else handleActiveInput(data)
				} else if (kb.matches(data, "tui.select.cancel")) done(undefined)
				else if (focusPart === "value") handleActiveInput(data)
			}
		}
	})
}

function resultText(result: AgentToolResult<unknown>) {
	return result.content.map(part => (part.type === "text" ? part.text : `[${part.type}]`)).join("\n")
}

export default function lovelyDevToolsExtension(pi: ExtensionAPI) {
	pi.registerMessageRenderer(RUN_TOOL_CALL_MESSAGE_TYPE, (message, _state, theme) => {
		const details = isRunToolCallDetails(message.details) ? message.details : undefined
		const body = details ? `${details.toolName}\n\n${JSON.stringify(details.toolArgs, null, 2)}` : "Tool call"
		const box = new Box(1, 1, value => theme.bg("customMessageBg", value))
		box.addChild(new Text(body, 0, 0))
		return box
	})

	pi.registerMessageRenderer(RUN_TOOL_RESULT_MESSAGE_TYPE, (message, _state, theme) => {
		const details = isRunToolResultDetails(message.details) ? message.details : undefined
		const title = details ? `${details.toolName}${details.isError ? " (error)" : ""}` : ""
		const body = details ? `${title}\n${resultText(details.result)}` : title
		const box = new Box(1, 1, value => theme.bg(details?.isError ? "toolErrorBg" : "toolSuccessBg", value))
		box.addChild(new Text(body, 0, 0))
		return box
	})

	pi.on("context", event => ({
		messages: event.messages.filter(message => {
			if (!isRecord(message) || message.role !== "custom") return true
			return message.customType !== RUN_TOOL_CALL_MESSAGE_TYPE && message.customType !== RUN_TOOL_RESULT_MESSAGE_TYPE
		})
	}))

	pi.registerCommand("run-tool", {
		description: "Run a tool from TUI-provided arguments and store rendered call/result messages",
		async handler(args, ctx) {
			if (!ctx.hasUI) {
				ctx.ui.notify("/run-tool needs interactive UI.", "warning")
				return
			}

			await ctx.waitForIdle()

			const tools = [...pi.getAllTools()].sort((a: ToolInfo, b: ToolInfo) => a.name.localeCompare(b.name))
			if (tools.length === 0) {
				ctx.ui.notify("No tools available.", "warning")
				return
			}

			const activeTools = new Set(pi.getActiveTools())
			const byLabel = new Map(tools.map(tool => [toolLabel(tool, activeTools), tool]))
			const initialTool = args.trim() ? tools.find(tool => tool.name === args.trim()) : undefined
			let selectedTool = initialTool

			while (true) {
				selectedTool ??= byLabel.get((await ctx.ui.select("Tool:", [...byLabel.keys()])) ?? "")
				if (!selectedTool) return

				const definition = ctx.getToolDefinition(selectedTool.name)
				if (!definition) {
					ctx.ui.notify(`Cannot execute ${selectedTool.name}: tool definition not available.`, "error")
					return
				}

				const toolArgs = await editToolArgs(ctx, selectedTool)
				if (!toolArgs) {
					if (initialTool) return
					selectedTool = undefined
					continue
				}

				const now = Date.now()
				const toolCallId = `run_tool_${now}`
				pi.sendMessage({
					customType: RUN_TOOL_CALL_MESSAGE_TYPE,
					content: `Tool call: ${selectedTool.name}`,
					display: true,
					details: { toolName: selectedTool.name, toolArgs, toolCallId, timestamp: now } satisfies RunToolCallDetails
				})

				let result: AgentToolResult<unknown>
				let isError = false
				try {
					result = await definition.execute(toolCallId, toolArgs, undefined, undefined, ctx)
				} catch (error) {
					isError = true
					result = { content: [{ type: "text", text: error instanceof Error ? error.message : String(error) }], details: undefined }
				}

				pi.sendMessage({
					customType: RUN_TOOL_RESULT_MESSAGE_TYPE,
					content: resultText(result),
					display: true,
					details: { toolName: selectedTool.name, toolCallId, result, isError, timestamp: Date.now() } satisfies RunToolResultDetails
				})
				return
			}
		}
	})
}
