import {
	type AgentToolResult,
	createBashToolDefinition,
	createEditToolDefinition,
	createFindToolDefinition,
	createGrepToolDefinition,
	createLsToolDefinition,
	createReadToolDefinition,
	createWriteToolDefinition,
	type ExtensionAPI,
	type ExtensionCommandContext,
	ExtensionInputComponent,
	getSettingsListTheme
} from "@earendil-works/pi-coding-agent"
import { Box, Container, type SettingItem, SettingsList, Text } from "@earendil-works/pi-tui"

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

function coerceValue(text: string, schema: Schema | undefined): ArgValue | undefined {
	const type = schema?.type
	if (type === "string") return text
	if (type === "number" || type === "integer") {
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

function buildArgs(fields: ArgField[], values: Map<string, ArgValue>) {
	const args: Record<string, unknown> = {}
	for (const field of fields) {
		const value = values.get(field.path.join("."))
		if (value !== undefined && value !== OMIT) setNested(args, field.path, value)
	}
	return args
}

type ExecutableTool = {
	execute(
		toolCallId: string,
		params: Record<string, unknown>,
		signal: AbortSignal | undefined,
		onUpdate: undefined,
		ctx: ExtensionCommandContext
	): Promise<AgentToolResult<unknown>>
}

function getExecutableToolDefinition(name: string, cwd: string): ExecutableTool | undefined {
	switch (name) {
		case "bash":
			return createBashToolDefinition(cwd) as unknown as ExecutableTool
		case "edit":
			return createEditToolDefinition(cwd) as unknown as ExecutableTool
		case "find":
			return createFindToolDefinition(cwd) as unknown as ExecutableTool
		case "grep":
			return createGrepToolDefinition(cwd) as unknown as ExecutableTool
		case "ls":
			return createLsToolDefinition(cwd) as unknown as ExecutableTool
		case "read":
			return createReadToolDefinition(cwd) as unknown as ExecutableTool
		case "write":
			return createWriteToolDefinition(cwd) as unknown as ExecutableTool
		default:
			return undefined
	}
}

async function editToolArgs(ctx: ExtensionCommandContext, tool: ToolInfo): Promise<Record<string, unknown> | undefined> {
	const parameters = asSchema(tool.parameters)
	const fields = flattenFields(parameters)
	if (fields.length === 0) return {}

	const values = new Map<string, ArgValue>()
	for (const field of fields) values.set(field.path.join("."), field.required ? schemaDefault(field.schema) : OMIT)

	return ctx.ui.custom<Record<string, unknown> | undefined>((_tui, theme, _keybindings, done) => {
		let list: SettingsList
		const items: SettingItem[] = fields.map(field => {
			const id = field.path.join(".")
			const enumValues = field.schema ? schemaEnum(field.schema) : undefined
			const type = field.schema?.type
			const choices = enumValues?.map(value => JSON.stringify(value)) ?? (type === "boolean" ? ["true", "false"] : undefined)
			const item: SettingItem = {
				id,
				label: field.label,
				description: `${field.required ? "required" : "optional"} ${schemaType(field.schema)}${schemaDescription(field.schema) ? ` - ${schemaDescription(field.schema)}` : ""}`,
				currentValue: valueLabel(values.get(id) ?? OMIT)
			}
			if (choices) item.values = field.required ? choices : [OMIT_LABEL, ...choices]
			else {
				item.submenu = (currentValue, submenuDone) =>
					new ExtensionInputComponent(
						`Value for ${id} (${schemaType(field.schema)})`,
						currentValue === OMIT_LABEL ? "" : currentValue,
						value => {
							if (!field.required && value.trim() === OMIT_LABEL) {
								submenuDone(OMIT_LABEL)
								return
							}
							const coerced = coerceValue(value, field.schema)
							if (coerced === undefined) {
								ctx.ui.notify(`${id} must match ${schemaType(field.schema)}.`, "error")
								submenuDone(undefined)
								return
							}
							submenuDone(valueLabel(coerced))
						},
						() => submenuDone(undefined),
						{ tui: _tui }
					)
			}
			return item
		})
		const container = new Container()
		container.addChild(new Text(theme.fg("accent", theme.bold(`Arguments for ${tool.name}`)), 1, 1))
		container.addChild(new Text(theme.fg("dim", "Edit values. Escape when done. Optional fields can be <omit>."), 1, 0))
		list = new SettingsList(
			items,
			Math.min(items.length, 14),
			getSettingsListTheme(),
			(id, newValue) => {
				const field = fields.find(field => field.path.join(".") === id)
				if (!field) return
				if (newValue === OMIT_LABEL) values.set(id, OMIT)
				else if (field.schema?.type === "boolean") values.set(id, newValue === "true")
				else {
					const parsed = parseJsonValue(newValue)
					values.set(id, parsed === undefined ? newValue : parsed)
				}
				list.updateValue(id, valueLabel(values.get(id) ?? OMIT))
			},
			() => done(buildArgs(fields, values)),
			{ enableSearch: true }
		)
		container.addChild(list)
		return {
			render: (width: number) => container.render(width),
			invalidate: () => container.invalidate(),
			handleInput: (data: string) => list.handleInput(data)
		}
	})
}

function resultText(result: AgentToolResult<unknown>) {
	return result.content.map(part => (part.type === "text" ? part.text : `[${part.type}]`)).join("\n")
}

export default function lovelyDevToolsExtension(pi: ExtensionAPI) {
	pi.registerMessageRenderer(RUN_TOOL_CALL_MESSAGE_TYPE, (message, _state, theme) => {
		const details = isRunToolCallDetails(message.details) ? message.details : undefined
		const body = details ? `Tool call: ${details.toolName}\n\n${JSON.stringify(details.toolArgs, null, 2)}` : "Tool call"
		const box = new Box(1, 1, value => theme.bg("customMessageBg", value))
		box.addChild(new Text(body, 0, 0))
		return box
	})

	pi.registerMessageRenderer(RUN_TOOL_RESULT_MESSAGE_TYPE, (message, _state, theme) => {
		const details = isRunToolResultDetails(message.details) ? message.details : undefined
		const title = details ? `Tool result: ${details.toolName}${details.isError ? " (error)" : ""}` : "Tool result"
		const body = details ? `${title}\n\n${resultText(details.result)}` : title
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
			const selectedTool = initialTool ?? byLabel.get((await ctx.ui.select("Tool:", [...byLabel.keys()])) ?? "")
			if (!selectedTool) return

			const definition = getExecutableToolDefinition(selectedTool.name, ctx.cwd)
			if (!definition) {
				ctx.ui.notify(`Cannot execute ${selectedTool.name}: pi does not expose executable definitions for extension tools yet.`, "error")
				return
			}

			const toolArgs = await editToolArgs(ctx, selectedTool)
			if (!toolArgs) return

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
		}
	})
}
