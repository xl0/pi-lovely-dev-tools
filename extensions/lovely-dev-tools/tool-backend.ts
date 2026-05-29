import { resolve } from "node:path"
import { validateToolArguments } from "@earendil-works/pi-ai"
import {
	type AgentSessionRuntimeDiagnostic,
	type AgentToolResult,
	createAgentSessionFromServices,
	createAgentSessionServices,
	type ExtensionCommandContext,
	type ExtensionUIContext,
	SessionManager,
	type ToolDefinition
} from "@earendil-works/pi-coding-agent"

export type ToolBackend = {
	diagnostics: AgentSessionRuntimeDiagnostic[]
	run(toolName: string, toolArgs: Record<string, unknown>, toolCallId: string): Promise<AgentToolResult<unknown>>
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

function parseStartupExtensionArgs(argv: string[]) {
	const extensions: string[] = []
	const unknownFlags = new Map<string, boolean | string>()
	let noExtensions = false
	for (let index = 0; index < argv.length; index++) {
		const arg = argv[index]
		if ((arg === "--extension" || arg === "-e") && argv[index + 1]) extensions.push(argv[++index] ?? "")
		else if (arg === "--no-extensions" || arg === "-ne") noExtensions = true
		else if (arg?.startsWith("--")) {
			const eqIndex = arg.indexOf("=")
			if (eqIndex >= 0) unknownFlags.set(arg.slice(2, eqIndex), arg.slice(eqIndex + 1))
			else unknownFlags.set(arg.slice(2), true)
		}
	}
	return { extensions, noExtensions, unknownFlags }
}

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
	const parsed = parseStartupExtensionArgs(process.argv.slice(2))
	const resourceLoaderOptions = {
		...(parsed.extensions.length > 0 ? { additionalExtensionPaths: resolveExtensionPaths(parsed.extensions) } : {}),
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
	return {
		diagnostics,
		async run(toolName, toolArgs, toolCallId) {
			const definition = created.session.getToolDefinition(toolName)
			if (!definition) {
				throw new Error(
					`Tool "${toolName}" is visible in the outer session but missing from the Nested Execution Session. Static Startup Tools only are supported.${diagnosticsText(diagnostics)}`
				)
			}
			const args = prepareArgs(definition, toolArgs)
			const abort = new AbortController()
			return definition.execute(toolCallId, args, abort.signal, undefined, created.session.extensionRunner.createContext())
		},
		dispose() {
			created.session.dispose()
		}
	}
}
