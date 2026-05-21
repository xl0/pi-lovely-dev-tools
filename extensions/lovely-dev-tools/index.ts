import type { ExtensionAPI } from "@earendil-works/pi-coding-agent"
import { Box, Text } from "@earendil-works/pi-tui"

const RUN_TOOL_MESSAGE_TYPE = "lovely-dev-tools.run-tool"

type ToolInfo = ReturnType<ExtensionAPI["getAllTools"]>[number]

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

function parseJsonObject(value: string): Record<string, unknown> | undefined {
	try {
		const parsed = JSON.parse(value)
		if (isRecord(parsed)) return parsed
	} catch {
		// handled by caller
	}
	return undefined
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

			const argsText = await ctx.ui.input(`Arguments for ${selectedTool.name} (JSON object):`, "{}")
			if (argsText === undefined) return
			const toolArgs = parseJsonObject(argsText.trim() || "{}")
			if (!toolArgs) {
				ctx.ui.notify("Tool arguments must be a JSON object.", "error")
				return
			}

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
