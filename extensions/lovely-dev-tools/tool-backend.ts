import { resolve } from "node:path"
import { validateToolArguments } from "@earendil-works/pi-ai"
import {
	type AgentSessionRuntimeDiagnostic,
	type AgentToolUpdateCallback,
	createAgentSessionFromServices,
	createAgentSessionServices,
	type ExtensionCommandContext,
	parseArgs,
	SessionManager,
	type ToolDefinition
} from "@earendil-works/pi-coding-agent"

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

export async function createToolBackend(ctx: ExtensionCommandContext, activeTools: string[]) {
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
	await created.session.bindExtensions({})
	created.session.setActiveToolsByName(activeTools)
	created.session.extensionRunner.setUIContext(ctx.ui, ctx.mode)
	const diagnostics = [...services.diagnostics]
	const abort = new AbortController()
	return {
		async run(toolName: string, toolArgs: Record<string, unknown>, toolCallId: string, onUpdate?: AgentToolUpdateCallback<unknown>) {
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
