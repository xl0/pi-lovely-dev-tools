import type { ExtensionAPI, Theme, ToolInfo } from "@earendil-works/pi-coding-agent"
import { Box, Text } from "@earendil-works/pi-tui"
import { SYSTEM_PROMPT_MESSAGE_TYPE, TOOL_SCHEMAS_MESSAGE_TYPE } from "./messages"
import { asSchema, formatSchemaType, schemaStringArray } from "./schema"

function formatCollapsibleMessage(title: string, content: string, expanded: boolean, theme: Theme) {
	const lineCount = content.length === 0 ? 0 : content.split("\n").length
	const header = expanded
		? `${theme.fg("accent", theme.bold(title))}${theme.fg("dim", " (Ctrl+o to collapse)")}`
		: `${theme.fg("accent", theme.bold(title))}${theme.fg("dim", ` (${lineCount} lines, Ctrl+o to expand)`)}`
	const text = expanded ? `${header}\n\n${content}` : header
	const box = new Box(1, 1, value => theme.bg("customMessageBg", value))
	box.addChild(new Text(text, 0, 0))
	return box
}

type CollapsibleMessageDetails = {
	content: string
}

function detailsContent(details: unknown): string {
	const content = (details as { content?: unknown } | undefined)?.content
	return typeof content === "string" ? content : ""
}

function formatToolSchemas(tools: ToolInfo[]): string {
	if (tools.length === 0) return "No active tools."
	return tools
		.map(tool => {
			const parameters = asSchema(tool.parameters)
			const properties = asSchema(parameters?.properties)
			const required = new Set(schemaStringArray(parameters?.required) ?? [])
			const parameterNames = properties ? Object.keys(properties) : []
			const header = `${tool.name} - ${tool.description}`
			if (parameterNames.length === 0) return `${header}\n  (no parameters)`
			const params = parameterNames
				.map(name => {
					const property = asSchema(properties?.[name])
					const presence = required.has(name) ? "required" : "optional"
					const description = property?.description ? ` - ${property.description}` : ""
					return `  ${name}: ${formatSchemaType(property)} [${presence}]${description}`
				})
				.join("\n")
			return `${header}\n${params}`
		})
		.join("\n\n")
}

export function registerShowSyspromptCommand(pi: ExtensionAPI) {
	pi.registerMessageRenderer(SYSTEM_PROMPT_MESSAGE_TYPE, (message, { expanded }, theme) =>
		formatCollapsibleMessage("System prompt", detailsContent(message.details), expanded, theme)
	)
	pi.registerMessageRenderer(TOOL_SCHEMAS_MESSAGE_TYPE, (message, { expanded }, theme) =>
		formatCollapsibleMessage("Available tools", detailsContent(message.details), expanded, theme)
	)

	pi.registerCommand("show-sysprompt", {
		description: "Show the effective system prompt and active tool schemas.",
		async handler(_args, ctx) {
			await ctx.waitForIdle()
			const activeTools = new Set(pi.getActiveTools())
			pi.sendMessage({
				customType: SYSTEM_PROMPT_MESSAGE_TYPE,
				content: "",
				display: true,
				details: { content: ctx.getSystemPrompt() } satisfies CollapsibleMessageDetails
			})
			pi.sendMessage({
				customType: TOOL_SCHEMAS_MESSAGE_TYPE,
				content: "",
				display: true,
				details: {
					content: formatToolSchemas(pi.getAllTools().filter(tool => activeTools.has(tool.name)))
				} satisfies CollapsibleMessageDetails
			})
		}
	})
}
