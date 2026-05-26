import {
	type AgentToolResult,
	convertToPng,
	type ExtensionAPI,
	type ExtensionCommandContext,
	getSettingsListTheme,
	type Theme
} from "@earendil-works/pi-coding-agent"
import type { AutocompleteItem, TUI } from "@earendil-works/pi-tui"
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

const RUN_TOOL_MESSAGE_TYPE = "lovely-dev-tools.run-tool"
const SYSTEM_PROMPT_MESSAGE_TYPE = "lovely-dev-tools.system-prompt"
const TOOL_SCHEMAS_MESSAGE_TYPE = "lovely-dev-tools.tool-schemas"
const HIDDEN_MESSAGE_TYPES = new Set([RUN_TOOL_MESSAGE_TYPE, SYSTEM_PROMPT_MESSAGE_TYPE, TOOL_SCHEMAS_MESSAGE_TYPE])
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

type RunToolDetails = {
	toolName: string
	toolArgs: Record<string, unknown>
	toolCallId: string
	result: AgentToolResult<unknown>
	isError: boolean
	timestamp: number
}

type ArgPath = Array<string | number>
type ArgRowKind = "field" | "object" | "array" | "item"
type ArgRow = {
	kind: ArgRowKind
	path: ArgPath
	label: string
	schema: Schema | undefined
	required: boolean
	arrayPath?: ArgPath
	arrayIndex?: number
}
type ArrayContext = {
	arrayPath: ArgPath
	arrayIndex: number
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
		typeof details.toolCallId === "string" &&
		isRecord(details.result) &&
		typeof details.isError === "boolean" &&
		typeof details.timestamp === "number"
	)
}

async function selectTool(ctx: ExtensionCommandContext, tools: ToolInfo[], activeTools: Set<string>) {
	return ctx.ui.custom<ToolInfo | undefined>((_tui, theme, _keybindings, done) => {
		const listTheme = getSettingsListTheme()
		const searchInput = new Input()
		searchInput.focused = true
		let filteredTools = tools
		let selectedIndex = 0

		const applyFilter = () => {
			const query = searchInput.getValue()
			filteredTools = query ? fuzzyFilter(tools, query, tool => tool.name) : tools
			selectedIndex = 0
		}

		return {
			render: (width: number) => {
				const lines = [theme.fg("accent", theme.bold("Tool:")), ...(searchInput.render(width)[0] ? searchInput.render(width) : [""]), ""]
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

function cloneSchemaValue(value: unknown): unknown {
	if (value === null || typeof value !== "object") return value
	return JSON.parse(JSON.stringify(value)) as unknown
}

function objectSchemaHasProperties(schema: Schema | undefined) {
	return !!asSchema(schema?.properties)
}

function defaultObjectValue(schema: Schema | undefined): Record<string, unknown> {
	const object: Record<string, unknown> = {}
	const properties = asSchema(schema?.properties)
	const required = new Set(schemaStringArray(schema?.required) ?? [])
	if (!properties) return object
	for (const [name, rawSchema] of Object.entries(properties)) {
		if (required.has(name)) object[name] = defaultValue(asSchema(rawSchema), true)
	}
	return object
}

function defaultValue(schema: Schema | undefined, seedArray: boolean): unknown {
	if (!schema) return null
	if ("default" in schema) return cloneSchemaValue(schema.default)
	if ("const" in schema) return cloneSchemaValue(schema.const)
	const enumValues = schemaEnum(schema)
	if (enumValues?.length) return cloneSchemaValue(enumValues[0])
	const type = schema.type
	if (type === "string") return ""
	if (type === "number" || type === "integer") return 0
	if (type === "boolean") return false
	if (type === "object" || objectSchemaHasProperties(schema)) return defaultObjectValue(schema)
	if (type === "array") {
		const items = asSchema(schema.items)
		return seedArray && items ? [defaultValue(items, false)] : []
	}
	return null
}

function valueLabel(value: ArgValue) {
	if (value === OMIT) return OMIT_LABEL
	const json = JSON.stringify(value)
	return json === undefined ? "undefined" : json
}

function inputValue(value: ArgValue, _schema: Schema | undefined) {
	if (value === OMIT) return ""
	return valueLabel(value)
}

function coerceValue(text: string, schema: Schema | undefined): ArgValue | undefined {
	const type = schema?.type
	if (type === "string") {
		const parsed = parseJsonValue(text.trim())
		return typeof parsed === "string" ? parsed : undefined
	}
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

function pathLabel(path: ArgPath) {
	let label = ""
	for (const part of path) label += typeof part === "number" ? `[${part}]` : label ? `.${part}` : part
	return label
}

function samePath(a: ArgPath, b: ArgPath) {
	return a.length === b.length && a.every((part, index) => part === b[index])
}

function isContainer(value: unknown): value is Record<string, unknown> | unknown[] {
	return isRecord(value) || Array.isArray(value)
}

function getAt(root: unknown, path: ArgPath): unknown {
	let current = root
	for (const part of path) {
		if (typeof part === "number") {
			if (!Array.isArray(current)) return undefined
			current = current[part]
		} else {
			if (!isRecord(current)) return undefined
			current = current[part]
		}
	}
	return current
}

function hasAt(root: unknown, path: ArgPath) {
	let current = root
	for (const part of path) {
		if (typeof part === "number") {
			if (!Array.isArray(current) || !(part in current)) return false
			current = current[part]
		} else {
			if (!isRecord(current) || !Object.hasOwn(current, part)) return false
			current = current[part]
		}
	}
	return true
}

function setAt(root: Record<string, unknown>, path: ArgPath, value: unknown) {
	let current: Record<string, unknown> | unknown[] = root
	for (let index = 0; index < path.length - 1; index++) {
		const part = path[index]
		const nextPart = path[index + 1]
		if (part === undefined || nextPart === undefined) return
		let next: unknown
		if (typeof part === "number") {
			if (!Array.isArray(current)) return
			next = current[part]
			if (!isContainer(next)) {
				const created: Record<string, unknown> | unknown[] = typeof nextPart === "number" ? [] : {}
				current[part] = created
				next = created
			}
		} else {
			if (!isRecord(current)) return
			next = current[part]
			if (!isContainer(next)) {
				const created: Record<string, unknown> | unknown[] = typeof nextPart === "number" ? [] : {}
				current[part] = created
				next = created
			}
		}
		if (!isContainer(next)) return
		current = next
	}
	const last = path.at(-1)
	if (last === undefined) return
	if (typeof last === "number") {
		if (Array.isArray(current)) current[last] = value
	} else if (isRecord(current)) current[last] = value
}

function deleteAt(root: Record<string, unknown>, path: ArgPath) {
	const parent = getAt(root, path.slice(0, -1))
	const last = path.at(-1)
	if (last === undefined) return
	if (typeof last === "number") {
		if (Array.isArray(parent)) parent.splice(last, 1)
	} else if (isRecord(parent)) delete parent[last]
}

function getArrayAt(root: unknown, path: ArgPath) {
	const value = getAt(root, path)
	return Array.isArray(value) ? value : undefined
}

function makeRow(row: Omit<ArgRow, "arrayPath" | "arrayIndex">, arrayContext?: ArrayContext): ArgRow {
	return arrayContext ? { ...row, arrayPath: arrayContext.arrayPath, arrayIndex: arrayContext.arrayIndex } : row
}

function buildObjectRows(
	schema: Schema | undefined,
	args: Record<string, unknown>,
	path: ArgPath = [],
	depth = 0,
	arrayContext?: ArrayContext
): ArgRow[] {
	const properties = asSchema(schema?.properties)
	if (!properties) return []
	const required = new Set(schemaStringArray(schema?.required) ?? [])
	const rows: ArgRow[] = []
	for (const [name, rawSchema] of Object.entries(properties)) {
		const propertySchema = asSchema(rawSchema)
		const propertyPath = [...path, name]
		const base = {
			path: propertyPath,
			label: `${"  ".repeat(depth)}${name}`,
			schema: propertySchema,
			required: required.has(name)
		}
		if (propertySchema?.type === "array") {
			rows.push(makeRow({ ...base, kind: "array" }, arrayContext))
			if (hasAt(args, propertyPath)) rows.push(...buildArrayRows(propertySchema, args, propertyPath, depth + 1))
		} else if (propertySchema?.type === "object" || objectSchemaHasProperties(propertySchema)) {
			rows.push(makeRow({ ...base, kind: "object" }, arrayContext))
			if (hasAt(args, propertyPath)) rows.push(...buildObjectRows(propertySchema, args, propertyPath, depth + 1, arrayContext))
		} else rows.push(makeRow({ ...base, kind: "field" }, arrayContext))
	}
	return rows
}

function buildArrayRows(schema: Schema | undefined, args: Record<string, unknown>, arrayPath: ArgPath, depth: number): ArgRow[] {
	const rows: ArgRow[] = []
	const array = getArrayAt(args, arrayPath) ?? []
	const items = asSchema(schema?.items)
	for (let index = 0; index < array.length; index++) {
		const itemPath = [...arrayPath, index]
		const arrayContext = { arrayPath, arrayIndex: index }
		const label = `${"  ".repeat(depth)}[${index}]`
		if (items?.type === "array") {
			rows.push(makeRow({ kind: "array", path: itemPath, label, schema: items, required: true }, arrayContext))
			rows.push(...buildArrayRows(items, args, itemPath, depth + 1))
		} else if (items?.type === "object" || objectSchemaHasProperties(items)) {
			rows.push(makeRow({ kind: "item", path: itemPath, label, schema: items, required: true }, arrayContext))
			rows.push(...buildObjectRows(items, args, itemPath, depth + 1, arrayContext))
		} else rows.push(makeRow({ kind: "field", path: itemPath, label, schema: items, required: true }, arrayContext))
	}
	return rows
}

function schemaSummaryLines(schema: Schema | undefined, required: boolean, indent = "  "): string[] {
	const lines = [`${indent}${required ? "required" : "optional"} ${schemaType(schema)}`]
	const description = schemaDescription(schema)
	if (description) lines.push(...wrapText(`${indent}${description}`, 120))
	const items = asSchema(schema?.items)
	if (items) {
		lines.push(`${indent}items:`)
		lines.push(...schemaSummaryLines(items, true, `${indent}  `))
	}
	const properties = asSchema(schema?.properties)
	if (properties) {
		const requiredProperties = new Set(schemaStringArray(schema?.required) ?? [])
		for (const [name, rawSchema] of Object.entries(properties)) {
			const propertySchema = asSchema(rawSchema)
			const propertyLines = schemaSummaryLines(propertySchema, requiredProperties.has(name), `${indent}  `)
			const [firstLine = `${indent}  ${name}: any`, ...rest] = propertyLines
			lines.push(`${indent}${name}: ${firstLine.trimStart()}`)
			lines.push(...rest)
		}
	}
	return lines
}

async function editToolArgs(ctx: ExtensionCommandContext, tool: ToolInfo): Promise<Record<string, unknown> | undefined> {
	const parameters = asSchema(tool.parameters)
	const args = defaultObjectValue(parameters)
	const initialRows = buildObjectRows(parameters, args)
	if (initialRows.length === 0) return {}

	return ctx.ui.custom<Record<string, unknown> | undefined>((_tui, theme, _keybindings, done) => {
		const listTheme = getSettingsListTheme()
		let rows = initialRows
		let selectedIndex = 0
		let focusPart: "include" | "value" = "value"
		let activeInput: Input | undefined

		const selectedRow = () => rows[selectedIndex]
		const rowCanInclude = (row: ArgRow) => row.kind !== "item" && !row.required
		const rowIncluded = (row: ArgRow) => row.kind === "item" || row.required || hasAt(args, row.path)
		const rowChoices = (row: ArgRow | undefined) => {
			if (!row || row.kind !== "field") return undefined
			const enumValues = row.schema ? schemaEnum(row.schema) : undefined
			const enumChoices = enumValues?.map(valueLabel)
			return enumChoices?.length ? enumChoices : row.schema?.type === "boolean" ? ["true", "false"] : undefined
		}
		const setRowValueFromLabel = (row: ArgRow, label: string) => {
			if (row.schema?.type === "boolean") setAt(args, row.path, label === "true")
			else {
				const parsed = parseJsonValue(label)
				setAt(args, row.path, parsed === undefined ? label : parsed)
			}
		}
		const inputCursor = (input: Input) => (input as unknown as { cursor: number }).cursor
		const setInputCursor = (input: Input, cursor: number) => {
			;(input as unknown as { cursor: number }).cursor = cursor
		}
		const renderInput = (input: Input, width: number) => input.render(width + 2)[0]?.slice(2) ?? ""
		const updateFocus = () => {
			const row = selectedRow()
			focusPart = row && rowCanInclude(row) && !rowIncluded(row) ? "include" : "value"
		}
		const updateActiveInput = () => {
			const row = selectedRow()
			if (!row || row.kind !== "field" || rowChoices(row) || !rowIncluded(row)) {
				activeInput = undefined
				return
			}
			const input = new Input()
			input.setValue(inputValue(hasAt(args, row.path) ? getAt(args, row.path) : OMIT, row.schema))
			setInputCursor(input, row.schema?.type === "string" ? Math.max(1, input.getValue().length - 1) : input.getValue().length)
			input.focused = true
			activeInput = input
		}
		const refreshRows = () => {
			rows = buildObjectRows(parameters, args)
			if (selectedIndex >= rows.length) selectedIndex = Math.max(0, rows.length - 1)
			updateActiveInput()
			updateFocus()
		}
		const selectPath = (path: ArgPath) => {
			const index = rows.findIndex(row => samePath(row.path, path))
			if (index >= 0) selectedIndex = index
			updateActiveInput()
			updateFocus()
		}
		const commitActiveInput = () => {
			const row = selectedRow()
			if (!row || !activeInput || row.kind !== "field" || !rowIncluded(row)) return true
			const value = activeInput.getValue()
			const coerced = coerceValue(value, row.schema)
			if (coerced === undefined) {
				ctx.ui.notify(`${pathLabel(row.path)} must match ${schemaType(row.schema)}.`, "error")
				return false
			}
			setAt(args, row.path, coerced)
			return true
		}
		const handleActiveInput = (data: string) => {
			activeInput?.handleInput(data)
		}
		const toggleInclude = () => {
			const row = selectedRow()
			if (!row || !rowCanInclude(row)) return
			if (rowIncluded(row)) {
				deleteAt(args, row.path)
				focusPart = "include"
			} else {
				setAt(args, row.path, defaultValue(row.schema, true))
				focusPart = "value"
			}
			refreshRows()
		}
		const addArrayItemForRow = (row: ArgRow, afterIndex?: number) => {
			if (row.kind !== "array") return false
			if (!hasAt(args, row.path)) setAt(args, row.path, [])
			const array = getArrayAt(args, row.path)
			if (!array) return false
			const itemSchema = asSchema(row.schema?.items)
			const index = afterIndex === undefined ? array.length : Math.min(array.length, afterIndex + 1)
			array.splice(index, 0, defaultValue(itemSchema, false))
			refreshRows()
			selectPath([...row.path, index])
			return true
		}
		const addArrayItemForSelection = () => {
			const row = selectedRow()
			if (!row) return false
			const arrayRow =
				row.kind === "array"
					? row
					: row.arrayPath
						? rows.find(candidate => candidate.kind === "array" && samePath(candidate.path, row.arrayPath ?? []))
						: undefined
			return arrayRow ? addArrayItemForRow(arrayRow, row.kind === "array" ? -1 : row.arrayIndex) : false
		}
		const removeArrayItemAt = (arrayPath: ArgPath, index: number) => {
			const array = getArrayAt(args, arrayPath)
			if (!array || index < 0 || index >= array.length) return false
			array.splice(index, 1)
			refreshRows()
			selectPath(array.length > 0 ? [...arrayPath, Math.min(index, array.length - 1)] : arrayPath)
			return true
		}
		const removeSelectedArrayItem = () => {
			const row = selectedRow()
			if (!row) return false
			if (row.kind === "array") {
				const array = getArrayAt(args, row.path)
				return array ? removeArrayItemAt(row.path, array.length - 1) : false
			}
			return row.arrayPath && row.arrayIndex !== undefined ? removeArrayItemAt(row.arrayPath, row.arrayIndex) : false
		}
		const rowValue = (row: ArgRow, index: number, valueWidth: number) => {
			if (!rowIncluded(row)) return OMIT_LABEL
			if (row.kind === "object") {
				const value = getAt(args, row.path)
				const count = isRecord(value) ? Object.keys(value).length : 0
				return `${count} prop${count === 1 ? "" : "s"}`
			}
			if (row.kind === "array") {
				const count = getArrayAt(args, row.path)?.length ?? 0
				return `${count} item${count === 1 ? "" : "s"}`
			}
			if (row.kind === "item") return schemaType(row.schema)
			if (activeInput && index === selectedIndex)
				return focusPart === "value" ? renderInput(activeInput, valueWidth) : activeInput.getValue()
			return valueLabel(hasAt(args, row.path) ? getAt(args, row.path) : OMIT)
		}
		updateActiveInput()
		updateFocus()

		return {
			render: (width: number) => {
				const selected = selectedRow()
				const lines: string[] = [theme.fg("accent", theme.bold(`Arguments for ${tool.name}`))]
				const helpLines: string[] = selected
					? [
							...wrapText(tool.description, width - 2),
							`${pathLabel(selected.path)} · ${selected.kind}`,
							...schemaSummaryLines(selected.schema, selected.required).flatMap(line => wrapText(line, width))
						]
					: wrapText(tool.description, width - 2)
				for (let index = 0; index < 5; index++) {
					const line = helpLines[index]
					if (line) lines.push(listTheme.description(`  ${line}`))
					else lines.push("")
				}
				lines.push(
					theme.fg("dim", "Enter run · Esc back · ←/→ include/value · Space toggle/cycle bools/enums · + insert item · - remove item"),
					""
				)

				const maxVisible = 16
				const startIndex = Math.max(0, Math.min(selectedIndex - Math.floor(maxVisible / 2), Math.max(0, rows.length - maxVisible)))
				const endIndex = Math.min(startIndex + maxVisible, rows.length)
				const maxLabelWidth = Math.min(34, Math.max(...rows.map(row => visibleWidth(row.label))))
				for (let index = startIndex; index < startIndex + maxVisible; index++) {
					const row = index < endIndex ? rows[index] : undefined
					if (!row) {
						lines.push("")
						continue
					}
					const isSelected = index === selectedIndex
					const prefix = isSelected ? listTheme.cursor : "  "
					const isIncluded = rowIncluded(row)
					const controlText = row.kind === "item" ? "    " : `${isIncluded ? "[x]" : "[ ]"} `
					const controlSelected = isSelected && focusPart === "include" && rowCanInclude(row)
					const control = row.kind === "item" || row.required ? theme.fg("dim", controlText) : listTheme.label(controlText, controlSelected)
					const label = listTheme.label(row.label + " ".repeat(Math.max(0, maxLabelWidth - visibleWidth(row.label))), isSelected)
					const valueWidth = Math.max(1, width - visibleWidth(prefix) - visibleWidth(controlText) - maxLabelWidth - 6)
					const rawValue = rowValue(row, index, valueWidth)
					const valueSelected = isSelected && focusPart === "value"
					const value = listTheme.value(truncateToWidth(rawValue, valueWidth, ""), valueSelected)
					lines.push(truncateToWidth(`${prefix}${control}${label}  ${value}`, width))
				}
				lines.push(startIndex > 0 || endIndex < rows.length ? listTheme.hint(`  (${selectedIndex + 1}/${rows.length})`) : "")
				return lines
			},
			invalidate: () => activeInput?.invalidate(),
			handleInput: (data: string) => {
				const kb = getKeybindings()
				if (kb.matches(data, "tui.input.submit")) {
					if (commitActiveInput()) done(args)
				} else if (kb.matches(data, "tui.select.up")) {
					if (!commitActiveInput()) return
					selectedIndex = selectedIndex === 0 ? rows.length - 1 : selectedIndex - 1
					updateActiveInput()
					updateFocus()
				} else if (kb.matches(data, "tui.select.down")) {
					if (!commitActiveInput()) return
					selectedIndex = selectedIndex === rows.length - 1 ? 0 : selectedIndex + 1
					updateActiveInput()
					updateFocus()
				} else if (kb.matches(data, "tui.editor.cursorRight")) {
					const row = selectedRow()
					if (focusPart === "include" && row && rowIncluded(row)) focusPart = "value"
					else if (focusPart === "value") handleActiveInput(data)
				} else if (kb.matches(data, "tui.editor.cursorLeft")) {
					const row = selectedRow()
					if (focusPart === "value" && row && rowCanInclude(row) && (!activeInput || inputCursor(activeInput) === 0)) focusPart = "include"
					else if (focusPart === "value") handleActiveInput(data)
				} else if (data === " ") {
					const row = selectedRow()
					if (!row) return
					const choices = rowChoices(row)
					if (focusPart === "include") toggleInclude()
					else if (choices) {
						const current = valueLabel(hasAt(args, row.path) ? getAt(args, row.path) : OMIT)
						setRowValueFromLabel(row, choices[(choices.indexOf(current) + 1) % choices.length] ?? choices[0] ?? "null")
					} else handleActiveInput(data)
				} else if ((data === "+" || data === "=") && !activeInput) addArrayItemForSelection()
				else if (data === "-" && !activeInput) removeSelectedArrayItem()
				else if (kb.matches(data, "tui.select.cancel")) done(undefined)
				else if (focusPart === "value") handleActiveInput(data)
			}
		}
	})
}

function formatArgs(args: Record<string, unknown>) {
	return Object.entries(args)
		.map(([k, v]) => `${k}=${JSON.stringify(v)}`)
		.join(", ")
}

function wrapText(text: string, width: number) {
	if (width <= 0) return [""]
	const words = text.split(/(\s+)/).filter(Boolean)
	const lines: string[] = []
	let line = ""
	for (const word of words) {
		const next = `${line}${word}`
		if (line && visibleWidth(next) > width) {
			lines.push(line.trimEnd())
			line = word.trimStart()
			continue
		}
		line = next
	}
	if (line || lines.length === 0) lines.push(line.trimEnd())
	return lines
}

function imageParts(result: AgentToolResult<unknown>) {
	return result.content.flatMap(part => {
		if (part.type !== "image") return []
		const image = part as { data?: string; mimeType?: string; source?: { data?: string; media_type?: string } }
		const data = image.data ?? image.source?.data
		const mimeType = image.mimeType ?? image.source?.media_type
		return data && mimeType ? [{ data, mimeType }] : []
	})
}

async function convertResultImagesForTerminal(result: AgentToolResult<unknown>): Promise<AgentToolResult<unknown>> {
	if (getCapabilities().images !== "kitty") return result
	const content = await Promise.all(
		result.content.map(async part => {
			if (part.type !== "image" || part.mimeType === "image/png") return part
			const converted = await convertToPng(part.data, part.mimeType)
			return converted ? { ...part, data: converted.data, mimeType: converted.mimeType } : part
		})
	)
	return { ...result, content }
}

function resultText(result: AgentToolResult<unknown>) {
	return result.content
		.map(part => {
			if (part.type === "text") return part.text
			if (part.type === "image") {
				const image = part as { mimeType?: string; source?: { media_type?: string } }
				return `[image: ${image.mimeType ?? image.source?.media_type ?? "unknown"}]`
			}
			return `[${(part as { type: string }).type}]`
		})
		.join("\n")
}

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

function formatSchemaType(schema: Schema | undefined): string {
	if (!schema) return "any"
	if (schema.const !== undefined) return JSON.stringify(schema.const)
	if (Array.isArray(schema.enum)) return schema.enum.map(value => JSON.stringify(value)).join(" | ")
	if (Array.isArray(schema.anyOf)) return schema.anyOf.map(option => formatSchemaType(asSchema(option))).join(" | ")
	if (Array.isArray(schema.oneOf)) return schema.oneOf.map(option => formatSchemaType(asSchema(option))).join(" | ")
	if (schema.items) return `${formatSchemaType(asSchema(schema.items))}[]`
	if (Array.isArray(schema.type)) return schema.type.join(" | ")
	if (typeof schema.type === "string") return schema.type
	return "any"
}

function formatToolSchemas(tools: ToolInfo[]): string {
	if (tools.length === 0) return "No active tools."
	return tools
		.map(tool => {
			const parameters = asSchema(tool.parameters)
			const properties = asSchema(parameters?.properties)
			const required = new Set(Array.isArray(parameters?.required) ? parameters.required.filter(name => typeof name === "string") : [])
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
	return coerceValue(text, schema)
}

function flatToolArgs(tool: ToolInfo, values: string[]): Record<string, unknown> | undefined {
	const parameters = asSchema(tool.parameters)
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

export default function lovelyDevToolsExtension(pi: ExtensionAPI) {
	pi.registerMessageRenderer(RUN_TOOL_MESSAGE_TYPE, (message, _state, theme) => {
		const details = isRunToolDetails(message.details) ? message.details : undefined
		if (!details) {
			const box = new Box(1, 1, value => theme.bg("customMessageBg", value))
			box.addChild(new Text("Tool run", 0, 0))
			return box
		}
		const callLine = `Tool: ${theme.fg("toolTitle", theme.bold(`${details.toolName}(${formatArgs(details.toolArgs)})`))}`
		const output = resultText(details.result)
		const body = output ? `${callLine}\n\n${theme.fg("toolOutput", output)}` : callLine
		const box = new Box(1, 1, value => theme.bg(details.isError ? "toolErrorBg" : "toolSuccessBg", value))
		box.addChild(new Text(body, 0, 0))
		const images = imageParts(details.result)
		if (images.length === 0 || !getCapabilities().images) return box
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
	pi.registerMessageRenderer(SYSTEM_PROMPT_MESSAGE_TYPE, (message, { expanded }, theme) =>
		formatCollapsibleMessage("System prompt", typeof message.content === "string" ? message.content : "", expanded, theme)
	)
	pi.registerMessageRenderer(TOOL_SCHEMAS_MESSAGE_TYPE, (message, { expanded }, theme) =>
		formatCollapsibleMessage("Available tools", typeof message.content === "string" ? message.content : "", expanded, theme)
	)

	pi.on("session_before_tree", (event, ctx) => {
		const entry = ctx.sessionManager.getEntry(event.preparation.targetId)
		if (entry?.type === "custom_message" && HIDDEN_MESSAGE_TYPES.has(entry.customType)) return { cancel: true }
	})

	pi.on("context", event => ({
		messages: event.messages.filter(message => {
			if (!isRecord(message) || message.role !== "custom") return true
			return !HIDDEN_MESSAGE_TYPES.has(message.customType)
		})
	}))

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
			let selectedTool = initialTool
			let initialToolArgs = initialTool && parts.length > 1 ? flatToolArgs(initialTool, parts.slice(1)) : undefined
			if (initialTool && parts.length > 1 && !initialToolArgs) {
				ctx.ui.notify(`Could not parse flat args for ${initialTool.name}. Opening editor.`, "warning")
			}

			while (true) {
				selectedTool ??= await selectTool(ctx, tools, activeTools)
				if (!selectedTool) return

				const definition = ctx.getToolDefinition(selectedTool.name)
				if (!definition) {
					ctx.ui.notify(`Cannot execute ${selectedTool.name}: tool definition not available.`, "error")
					return
				}

				const toolArgs = initialToolArgs ?? (await editToolArgs(ctx, selectedTool))
				initialToolArgs = undefined
				if (!toolArgs) {
					if (initialTool) return
					selectedTool = undefined
					continue
				}

				const toolName = selectedTool.name
				let elapsedDone = false
				ctx.ui.setWidget("tool-loading", (tui: TUI, theme) => {
					let interval: ReturnType<typeof setInterval> | undefined
					const callLine = theme.fg("toolTitle", theme.bold(`${toolName}(${formatArgs(toolArgs)})`))
					const text = new Text(`${callLine}\n${theme.fg("toolOutput", "Tool is running...")}`, 0, 0)
					const box = new Box(1, 1, value => theme.bg("toolPendingBg", value))
					box.addChild(text)
					const comp = {
						invalidate() {
							box.invalidate()
						},
						render(width: number) {
							return box.render(width)
						},
						dispose() {
							if (interval) clearInterval(interval)
						}
					}
					interval = setInterval(() => {
						if (elapsedDone) {
							comp.dispose()
							return
						}
						tui.requestRender()
					}, 200)
					return comp
				})

				const now = Date.now()
				const toolCallId = `run_tool_${now}`

				let result: AgentToolResult<unknown>
				let isError = false
				try {
					result = await definition.execute(toolCallId, toolArgs, undefined, undefined, ctx)
				} catch (error) {
					isError = true
					result = { content: [{ type: "text", text: error instanceof Error ? error.message : String(error) }], details: undefined }
				}

				result = await convertResultImagesForTerminal(result)
				elapsedDone = true
				ctx.ui.setWidget("tool-loading", undefined)

				pi.sendMessage({
					customType: RUN_TOOL_MESSAGE_TYPE,
					content: resultText(result),
					display: true,
					details: { toolName, toolArgs, toolCallId, result, isError, timestamp: Date.now() } satisfies RunToolDetails
				})
				return
			}
		}
	})

	pi.registerCommand("show-sysprompt", {
		description: "Show the effective system prompt and active tool schemas.",
		async handler(_args, ctx) {
			await ctx.waitForIdle()
			const activeTools = new Set(pi.getActiveTools())
			pi.sendMessage({ customType: SYSTEM_PROMPT_MESSAGE_TYPE, content: ctx.getSystemPrompt(), display: true })
			pi.sendMessage({
				customType: TOOL_SCHEMAS_MESSAGE_TYPE,
				content: formatToolSchemas(pi.getAllTools().filter(tool => activeTools.has(tool.name))),
				display: true
			})
		}
	})
}
