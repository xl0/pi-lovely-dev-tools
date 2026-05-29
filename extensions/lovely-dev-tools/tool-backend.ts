import { resolve } from "node:path"
import { validateToolArguments } from "@earendil-works/pi-ai"
import {
	type AgentSessionRuntimeDiagnostic,
	type AgentToolResult,
	type AgentToolUpdateCallback,
	createAgentSessionFromServices,
	createAgentSessionServices,
	type ExtensionCommandContext,
	type ExtensionUIContext,
	parseArgs,
	SessionManager,
	type ToolDefinition
} from "@earendil-works/pi-coding-agent"

export type ToolBackend = {
	diagnostics: AgentSessionRuntimeDiagnostic[]
	run(
		toolName: string,
		toolArgs: Record<string, unknown>,
		toolCallId: string,
		onUpdate?: AgentToolUpdateCallback<unknown>
	): Promise<AgentToolResult<unknown>>
	abort(): void
	isAborted(): boolean
	dispose(): void
}

const mutedUi = new Proxy(
	{},
	{
		get: (_target, property) => {
			if (property === "confirm") return async () => false
			if (property === "getEditorText") return () => ""
			if (property === "onTerminalInput") return () => () => {}
			return () => undefined
		}
	}
) as ExtensionUIContext

function resolveExtensionPaths(paths: string[]): string[] {
	return paths.map(path => (path.startsWith(".") || path.startsWith("/") ? resolve(process.cwd(), path) : path))
}

function prepareArgs(definition: ToolDefinition, args: Record<string, unknown>) {
	const prepared = definition.prepareArguments ? definition.prepareArguments(args) : args
	return validateToolArguments(definition, {
		type: "toolCall",
		id: "manual",
		name: definition.name,
		arguments: prepared as Record<string, unknown>
	})
}

function diagnosticsText(diagnostics: AgentSessionRuntimeDiagnostic[]) {
	return diagnostics.length ? `\n\nNested diagnostics:\n${diagnostics.map(d => `- ${d.type}: ${d.message}`).join("\n")}` : ""
}

export async function createToolBackend(ctx: ExtensionCommandContext, activeTools: string[]): Promise<ToolBackend> {
	const parsed = parseArgs(process.argv.slice(2))
	const extensionPaths = parsed.extensions ?? []
	const resourceLoaderOptions = {
		...(extensionPaths.length > 0 ? { additionalExtensionPaths: resolveExtensionPaths(extensionPaths) } : {}),
		...(parsed.noExtensions ? { noExtensions: true } : {})
	}
	const services = await createAgentSessionServices({
		cwd: ctx.cwd,
		extensionFlagValues: parsed.unknownFlags,
		resourceLoaderOptions
	})
	const created = await createAgentSessionFromServices({
		services,
		sessionManager: SessionManager.inMemory(ctx.cwd)
	})
	await created.session.bindExtensions({ uiContext: mutedUi })
	created.session.setActiveToolsByName(activeTools)
	created.session.extensionRunner.setUIContext(ctx.ui)
	const diagnostics = [...services.diagnostics]
	const abort = new AbortController()
	return {
		diagnostics,
		async run(toolName, toolArgs, toolCallId, onUpdate) {
			const definition = created.session.getToolDefinition(toolName)
			if (!definition) {
				throw new Error(
					`Tool "${toolName}" is visible in the outer session but missing from the Nested Execution Session. Static Startup Tools only are supported.${diagnosticsText(diagnostics)}`
				)
			}
			const args = prepareArgs(definition, toolArgs)
			return definition.execute(toolCallId, args, abort.signal, onUpdate, created.session.extensionRunner.createContext())
		},
		abort() {
			abort.abort()
		},
		isAborted() {
			return abort.signal.aborted
		},
		dispose() {
			created.session.dispose()
		}
	}
}
