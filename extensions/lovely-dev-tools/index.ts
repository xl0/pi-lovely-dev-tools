import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent"
import { Box, Text } from "@earendil-works/pi-tui"

const RUN_TOOL_MESSAGE_TYPE = "lovely-dev-tools.run-tool"
const CANCEL = Symbol("cancel")
const OMIT = Symbol("omit")

type ToolInfo = ReturnType<ExtensionAPI["getAllTools"]>[number]
type Schema = Record<string, unknown>
type PromptValue = unknown | typeof CANCEL | typeof OMIT

type RunToolDetails = {
	toolName: string
	toolArgs: Record<string, unknown>
	responseText: string
	isError: boolean
	toolCallId: string
	timestamp: number
	api: string
	provider: string
	model: string
}

const emptyUsage = {
	input: 0,
	output: 0,
	cacheRead: 0,
	cacheWrite: 0,
	totalTokens: 0,
	cost: {
		input: 0,
		output: 0,
		cacheRead: 0,
		cacheWrite: 0,
		total: 0
	}
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

function isRunToolDetails(value: unknown): value is RunToolDetails {
	if (!isRecord(value)) return false
	const details = value as Partial<RunToolDetails>
	return (
		typeof details.toolName === "string" &&
		isRecord(details.toolArgs) &&
		typeof details.responseText === "string" &&
		typeof details.isError === "boolean" &&
		typeof details.toolCallId === "string" &&
		typeof details.timestamp === "number" &&
		typeof details.api === "string" &&
		typeof details.provider === "string" &&
		typeof details.model === "string"
	)
}

function getRunToolDetails(message: unknown): RunToolDetails | undefined {
	if (!isRecord(message)) return undefined
	const candidate = message as { role?: unknown; customType?: unknown; details?: unknown }
	if (candidate.role !== "custom" || candidate.customType !== RUN_TOOL_MESSAGE_TYPE) return undefined
	return isRunToolDetails(candidate.details) ? candidate.details : undefined
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
	const ownEnum = Array.isArray(schema["enum"]) ? schema["enum"] : undefined
	if (ownEnum) return ownEnum
	const variants = schemaArray(schema["anyOf"]) ?? schemaArray(schema["oneOf"])
	const values = variants?.map(variant => variant["const"])
	return values?.every(value => value !== undefined) ? values : undefined
}

function schemaType(schema: Schema | undefined): string {
	if (!schema) return "any"
	if ("const" in schema) return JSON.stringify(schema["const"])
	const enumValues = schemaEnum(schema)
	if (enumValues) return enumValues.map(value => JSON.stringify(value)).join(" | ")
	const variants = schemaArray(schema["anyOf"]) ?? schemaArray(schema["oneOf"])
	if (variants) return variants.map(schemaType).join(" | ")
	const items = asSchema(schema["items"])
	if (items) return `${schemaType(items)}[]`
	const type = schema["type"]
	if (Array.isArray(type)) return type.join(" | ")
	return typeof type === "string" ? type : "any"
}

function schemaDescription(schema: Schema | undefined) {
	return typeof schema?.["description"] === "string" ? schema["description"] : undefined
}

function schemaDefaultPlaceholder(schema: Schema | undefined, fallback: string) {
	return schema && "default" in schema ? JSON.stringify(schema["default"]) : fallback
}

function coerceScalarFromJson(value: string, schema: Schema | undefined): unknown | typeof CANCEL {
	const parsed = parseJsonValue(value)
	if (parsed === undefined) return CANCEL
	const type = schema?.["type"]
	if (type === "array" && !Array.isArray(parsed)) return CANCEL
	if (type === "object" && !isRecord(parsed)) return CANCEL
	return parsed
}

async function promptValue(
	ctx: ExtensionCommandContext,
	name: string,
	schema: Schema | undefined,
	required: boolean
): Promise<PromptValue> {
	if (schema && "const" in schema) return schema["const"]

	const description = schemaDescription(schema)
	const title = `${name} (${required ? "required" : "optional"}, ${schemaType(schema)})${description ? `: ${description}` : ""}`
	if (!required) {
		const action = await ctx.ui.select(title, ["omit", "set"])
		if (action === undefined) return CANCEL
		if (action === "omit") return OMIT
	}

	const enumValues = schema ? schemaEnum(schema) : undefined
	if (enumValues) {
		const labels = enumValues.map(value => JSON.stringify(value))
		const selected = await ctx.ui.select(title, labels)
		if (selected === undefined) return CANCEL
		return enumValues[labels.indexOf(selected)]
	}

	const type = schema?.["type"]
	if (type === "boolean") {
		const selected = await ctx.ui.select(title, ["true", "false"])
		if (selected === undefined) return CANCEL
		return selected === "true"
	}

	if (type === "number" || type === "integer") {
		const text = await ctx.ui.input(title, schemaDefaultPlaceholder(schema, "0"))
		if (text === undefined) return CANCEL
		const value = Number(text.trim())
		if (!Number.isFinite(value) || (type === "integer" && !Number.isInteger(value))) {
			ctx.ui.notify(`${name} must be a ${type}.`, "error")
			return CANCEL
		}
		return value
	}

	if (type === "string") {
		const text = await ctx.ui.input(title, schemaDefaultPlaceholder(schema, ""))
		return text === undefined ? CANCEL : text
	}

	const objectProperties = schema ? asSchema(schema["properties"]) : undefined
	if (type === "object" && objectProperties) return promptObject(ctx, objectProperties, schema, `${name}.`)

	const text = await ctx.ui.input(title, schemaDefaultPlaceholder(schema, type === "array" ? "[]" : type === "object" ? "{}" : "null"))
	if (text === undefined) return CANCEL
	const value = coerceScalarFromJson(text.trim() || "null", schema)
	if (value === CANCEL) ctx.ui.notify(`${name} must be valid JSON matching ${schemaType(schema)}.`, "error")
	return value
}

async function promptObject(
	ctx: ExtensionCommandContext,
	properties: Record<string, unknown>,
	schema: Schema | undefined,
	prefix = ""
): Promise<Record<string, unknown> | typeof CANCEL> {
	const required = new Set(schemaStringArray(schema?.["required"]) ?? [])
	const args: Record<string, unknown> = {}
	for (const [name, rawSchema] of Object.entries(properties)) {
		const value = await promptValue(ctx, `${prefix}${name}`, asSchema(rawSchema), required.has(name))
		if (value === CANCEL) return CANCEL
		if (value !== OMIT) args[name] = value
	}
	return args
}

async function promptToolArgs(ctx: ExtensionCommandContext, tool: ToolInfo): Promise<Record<string, unknown> | undefined> {
	const parameters = asSchema(tool.parameters)
	const properties = parameters ? asSchema(parameters["properties"]) : undefined
	if (!properties || Object.keys(properties).length === 0) return {}

	const args = await promptObject(ctx, properties, parameters)
	return args === CANCEL ? undefined : args
}

function runToolInstruction(details: RunToolDetails) {
	return `Use the ${details.toolName} tool with these arguments:\n\n${JSON.stringify(details.toolArgs, null, 2)}`
}

function projectRunTool(details: RunToolDetails) {
	return [
		{
			role: "user" as const,
			content: [{ type: "text" as const, text: runToolInstruction(details) }],
			timestamp: details.timestamp
		},
		{
			role: "assistant" as const,
			content: [
				{
					type: "toolCall" as const,
					id: details.toolCallId,
					name: details.toolName,
					arguments: details.toolArgs
				}
			],
			api: details.api,
			provider: details.provider,
			model: details.model,
			usage: emptyUsage,
			stopReason: "toolUse" as const,
			timestamp: details.timestamp
		},
		{
			role: "toolResult" as const,
			toolCallId: details.toolCallId,
			toolName: details.toolName,
			content: [{ type: "text" as const, text: details.responseText }],
			isError: details.isError,
			timestamp: details.timestamp
		}
	]
}

export default function lovelyDevToolsExtension(pi: ExtensionAPI) {
	pi.registerMessageRenderer(RUN_TOOL_MESSAGE_TYPE, (message, _state, theme) => {
		const details = isRunToolDetails(message.details) ? message.details : undefined
		const title = details ? `Synthetic tool run: ${details.toolName}${details.isError ? " (error)" : ""}` : "Synthetic tool run"
		const body = details
			? `${title}\n\nArguments:\n${JSON.stringify(details.toolArgs, null, 2)}\n\nResponse:\n${details.responseText}`
			: typeof message.content === "string"
				? message.content
				: title
		const box = new Box(1, 1, value => theme.bg("customMessageBg", value))
		box.addChild(new Text(body, 0, 0))
		return box
	})

	pi.on("context", event => ({
		messages: event.messages.flatMap(message => {
			const details = getRunToolDetails(message)
			return details ? projectRunTool(details) : [message]
		})
	}))

	pi.registerCommand("run-tool", {
		description: "Inject a synthetic tool call and tool result into chat history",
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

			const toolArgs = await promptToolArgs(ctx, selectedTool)
			if (!toolArgs) return

			const responseText = await ctx.ui.input("Tool response text:", "")
			if (responseText === undefined) return
			const isError = await ctx.ui.confirm("Tool response status", "Mark this tool result as an error?")

			const now = Date.now()
			const model = ctx.model
			const details: RunToolDetails = {
				toolName: selectedTool.name,
				toolArgs,
				responseText,
				isError,
				toolCallId: `run_tool_${now}`,
				timestamp: now,
				api: model?.api ?? "synthetic",
				provider: model?.provider ?? "synthetic",
				model: model?.id ?? "synthetic"
			}

			pi.sendMessage({
				customType: RUN_TOOL_MESSAGE_TYPE,
				content: runToolInstruction(details),
				display: true,
				details
			})

			ctx.ui.notify(`Injected ${selectedTool.name} tool call fixture.`, "info")
		}
	})
}
