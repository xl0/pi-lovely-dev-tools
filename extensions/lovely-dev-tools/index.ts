import type { ExtensionAPI } from "@earendil-works/pi-coding-agent"

type MutableSessionManager = {
	appendMessage(message: unknown): string
}

type ToolInfo = ReturnType<ExtensionAPI["getAllTools"]>[number]

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

function parseJsonObject(value: string): Record<string, unknown> | undefined {
	try {
		const parsed = JSON.parse(value)
		if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed as Record<string, unknown>
	} catch {
		// handled by caller
	}
	return undefined
}

function toolLabel(tool: ToolInfo, activeTools: Set<string>) {
	const active = activeTools.has(tool.name) ? "active" : "inactive"
	return `${tool.name} (${active}) - ${tool.description}`
}

export default function lovelyDevToolsExtension(pi: ExtensionAPI) {
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
			const toolCallId = `run_tool_${now}`
			const model = ctx.model
			const sessionManager = ctx.sessionManager as unknown as MutableSessionManager

			sessionManager.appendMessage({
				role: "user",
				content: [
					{
						type: "text",
						text: `Use the ${selectedTool.name} tool with these arguments:\n\n${JSON.stringify(toolArgs, null, 2)}`
					}
				],
				timestamp: now
			})
			sessionManager.appendMessage({
				role: "assistant",
				content: [
					{
						type: "toolCall",
						id: toolCallId,
						name: selectedTool.name,
						arguments: toolArgs
					}
				],
				api: model?.api ?? "synthetic",
				provider: model?.provider ?? "synthetic",
				model: model?.id ?? "synthetic",
				usage: emptyUsage,
				stopReason: "toolUse",
				timestamp: now
			})
			sessionManager.appendMessage({
				role: "toolResult",
				toolCallId,
				toolName: selectedTool.name,
				content: [{ type: "text", text: responseText }],
				isError,
				timestamp: now
			})

			ctx.ui.notify(`Injected ${selectedTool.name} tool call.`, "info")
		}
	})
}
