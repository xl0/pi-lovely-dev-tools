import { type ExtensionUIContext, getSettingsListTheme } from "@earendil-works/pi-coding-agent"
import { CURSOR_MARKER, getKeybindings, Input, truncateToWidth, visibleWidth } from "@earendil-works/pi-tui"
import {
	asSchema,
	coerceArgValue,
	defaultArgValue,
	defaultObjectArgs,
	formatArgValue,
	formatInputValue,
	formatSchemaType,
	getSchemaDescription,
	hasObjectSchemaProperties,
	isRecord,
	OMIT,
	OMIT_LABEL,
	parseJsonValue,
	type Schema,
	schemaEnum,
	schemaStringArray,
	wrapText
} from "./schema"

type ArgPath = Array<string | number>
type ArgRowKind = "field" | "object" | "array" | "item"
type ArgRow = {
	kind: ArgRowKind
	path: ArgPath
	label: string
	depth: number
	schema: Schema | undefined
	required: boolean
	arrayContext?: ArrayContext
}
type ArrayContext = {
	path: ArgPath
	index: number
}

type EditorState = {
	args: Record<string, unknown>
	rows: ArgRow[]
	selectedIndex: number
	focusPart: "include" | "value"
	activeInput: Input | undefined
}

type EditableTool = {
	name: string
	description: string
	parameters: unknown
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

function makeRow(row: Omit<ArgRow, "arrayContext">, arrayContext?: ArrayContext): ArgRow {
	return arrayContext ? { ...row, arrayContext } : row
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
			label: name,
			depth,
			schema: propertySchema,
			required: required.has(name)
		}
		if (propertySchema?.type === "array") {
			rows.push(makeRow({ ...base, kind: "array" }, arrayContext))
			if (hasAt(args, propertyPath)) rows.push(...buildArrayRows(propertySchema, args, propertyPath, depth + 1))
		} else if (propertySchema?.type === "object" || hasObjectSchemaProperties(propertySchema)) {
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
		const arrayContext = { path: arrayPath, index }
		const label = `[${index}]`
		if (items?.type === "array") {
			rows.push(makeRow({ kind: "array", path: itemPath, label, depth, schema: items, required: true }, arrayContext))
			rows.push(...buildArrayRows(items, args, itemPath, depth + 1))
		} else if (items?.type === "object" || hasObjectSchemaProperties(items)) {
			rows.push(makeRow({ kind: "item", path: itemPath, label, depth, schema: items, required: true }, arrayContext))
			rows.push(...buildObjectRows(items, args, itemPath, depth + 1, arrayContext))
		} else rows.push(makeRow({ kind: "field", path: itemPath, label, depth, schema: items, required: true }, arrayContext))
	}
	return rows
}

function schemaSummaryLines(schema: Schema | undefined, required: boolean, indent = "  "): string[] {
	const lines = [`${indent}${required ? "required" : "optional"} ${formatSchemaType(schema)}`]
	const description = getSchemaDescription(schema)
	if (description) lines.push(`${indent}${description}`)
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

export async function editToolArgs(ui: ExtensionUIContext, tool: EditableTool): Promise<Record<string, unknown> | undefined> {
	const parameters = asSchema(tool.parameters)
	const args = defaultObjectArgs(parameters)
	const initialRows = buildObjectRows(parameters, args)
	if (initialRows.length === 0) return {}

	return ui.custom<Record<string, unknown> | undefined>((_tui, theme, _keybindings, done) => {
		const listTheme = getSettingsListTheme()
		const state: EditorState = {
			args,
			rows: initialRows,
			selectedIndex: 0,
			focusPart: "value",
			activeInput: undefined
		}

		const selectedRow = () => state.rows[state.selectedIndex]
		const rowCanInclude = (row: ArgRow) => row.kind !== "item" && !row.required
		const rowIncluded = (row: ArgRow) => row.kind === "item" || row.required || hasAt(args, row.path)
		const rowChoices = (row: ArgRow | undefined) => {
			if (!row || row.kind !== "field") return undefined
			const enumValues = row.schema ? schemaEnum(row.schema) : undefined
			const enumChoices = enumValues?.map(formatArgValue)
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
		const renderStringInput = (input: Input, width: number) => {
			const text = `"${input.getValue()}"`
			const cursor = Math.min(inputCursor(input) + 1, text.length - 1)
			const beforeCursor = text.slice(0, cursor)
			const atCursor = text[cursor] ?? '"'
			const afterCursor = text.slice(cursor + atCursor.length)
			return truncateToWidth(`${beforeCursor}${CURSOR_MARKER}\x1b[7m${atCursor}\x1b[27m${afterCursor}`, width, "")
		}
		const formatEditorInputValue = (row: ArgRow) => {
			const value = hasAt(args, row.path) ? getAt(args, row.path) : OMIT
			return row.schema?.type === "string" && typeof value === "string" ? value : formatInputValue(value)
		}
		const updateFocus = () => {
			const row = selectedRow()
			state.focusPart = row && rowCanInclude(row) && !rowIncluded(row) ? "include" : "value"
		}
		const updateActiveInput = () => {
			const row = selectedRow()
			if (!row || row.kind !== "field" || rowChoices(row) || !rowIncluded(row)) {
				state.activeInput = undefined
				return
			}
			const input = new Input()
			input.setValue(formatEditorInputValue(row))
			setInputCursor(input, input.getValue().length)
			input.focused = true
			state.activeInput = input
		}
		const refreshRows = () => {
			state.rows = buildObjectRows(parameters, args)
			if (state.selectedIndex >= state.rows.length) state.selectedIndex = Math.max(0, state.rows.length - 1)
			updateActiveInput()
			updateFocus()
		}
		const selectPath = (path: ArgPath) => {
			const index = state.rows.findIndex(row => samePath(row.path, path))
			if (index >= 0) state.selectedIndex = index
			updateActiveInput()
			updateFocus()
		}
		const commitActiveInput = () => {
			const row = selectedRow()
			if (!row || !state.activeInput || row.kind !== "field" || !rowIncluded(row)) return true
			const value = state.activeInput.getValue()
			const coerced = row.schema?.type === "string" ? value : coerceArgValue(value, row.schema)
			if (coerced === undefined) {
				ui.notify(`${pathLabel(row.path)} must match ${formatSchemaType(row.schema)}.`, "error")
				return false
			}
			setAt(args, row.path, coerced)
			return true
		}
		const handleActiveInput = (data: string) => {
			state.activeInput?.handleInput(data)
		}
		const toggleInclude = () => {
			const row = selectedRow()
			if (!row || !rowCanInclude(row)) return
			if (rowIncluded(row)) {
				deleteAt(args, row.path)
				state.focusPart = "include"
			} else {
				setAt(args, row.path, defaultArgValue(row.schema, true))
				state.focusPart = "value"
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
			array.splice(index, 0, defaultArgValue(itemSchema, false))
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
					: row.arrayContext
						? state.rows.find(candidate => candidate.kind === "array" && samePath(candidate.path, row.arrayContext?.path ?? []))
						: undefined
			return arrayRow ? addArrayItemForRow(arrayRow, row.kind === "array" ? -1 : row.arrayContext?.index) : false
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
			return row.arrayContext ? removeArrayItemAt(row.arrayContext.path, row.arrayContext.index) : false
		}
		const rowLabel = (row: ArgRow) => `${"  ".repeat(row.depth)}${row.label}`
		const selectionHelpText = () => {
			const row = selectedRow()
			const parts = ["Enter run", "Esc back", "←/→ include/value", "Space toggle/cycle bools/enums"]
			if (row && (state.focusPart !== "value" || !state.activeInput) && (row.kind === "array" || row.arrayContext))
				parts.push("+ insert item", "- remove item")
			return parts.join(" · ")
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
			if (row.kind === "item") return ""
			if (state.activeInput && index === state.selectedIndex) {
				if (row.schema?.type === "string")
					return state.focusPart === "value" ? renderStringInput(state.activeInput, valueWidth) : `"${state.activeInput.getValue()}"`
				return state.focusPart === "value" ? renderInput(state.activeInput, valueWidth) : state.activeInput.getValue()
			}
			return formatArgValue(hasAt(args, row.path) ? getAt(args, row.path) : OMIT)
		}
		updateActiveInput()
		updateFocus()

		return {
			render: (width: number) => {
				const selected = selectedRow()
				const lines: string[] = [theme.fg("accent", theme.bold(`Arguments for ${tool.name}`))]
				const selectedSummary = selected && selected.kind !== "item" ? schemaSummaryLines(selected.schema, selected.required) : []
				const [selectedSummaryLine, ...selectedSummaryRest] = selectedSummary
				const helpLines: string[] = selected
					? [
							...wrapText(tool.description, width - 2),
							`${pathLabel(selected.path)} · ${selected.kind}${selectedSummaryLine ? ` · ${selectedSummaryLine.trim()}` : ""}`,
							...selectedSummaryRest.flatMap(line => wrapText(line, width))
						]
					: wrapText(tool.description, width - 2)
				for (let index = 0; index < 5; index++) {
					const line = helpLines[index]
					if (line) lines.push(listTheme.description(`  ${line}`))
					else lines.push("")
				}
				lines.push(theme.fg("dim", selectionHelpText()), "")

				const maxVisible = 16
				const startIndex = Math.max(
					0,
					Math.min(state.selectedIndex - Math.floor(maxVisible / 2), Math.max(0, state.rows.length - maxVisible))
				)
				const endIndex = Math.min(startIndex + maxVisible, state.rows.length)
				const maxLabelWidth = Math.min(34, Math.max(...state.rows.map(row => visibleWidth(rowLabel(row)))))
				for (let index = startIndex; index < startIndex + maxVisible; index++) {
					const row = index < endIndex ? state.rows[index] : undefined
					if (!row) {
						lines.push("")
						continue
					}
					const isSelected = index === state.selectedIndex
					const prefix = isSelected ? listTheme.cursor : "  "
					const isIncluded = rowIncluded(row)
					const controlText = row.kind === "item" ? "    " : `${isIncluded ? "[x]" : "[ ]"} `
					const controlSelected = isSelected && state.focusPart === "include" && rowCanInclude(row)
					const control = row.kind === "item" || row.required ? theme.fg("dim", controlText) : listTheme.label(controlText, controlSelected)
					const labelText = rowLabel(row)
					const label = listTheme.label(labelText + " ".repeat(Math.max(0, maxLabelWidth - visibleWidth(labelText))), isSelected)
					const valueWidth = Math.max(1, width - visibleWidth(prefix) - visibleWidth(controlText) - maxLabelWidth - 6)
					const rawValue = rowValue(row, index, valueWidth)
					const valueSelected = isSelected && state.focusPart === "value"
					const value = listTheme.value(truncateToWidth(rawValue, valueWidth, ""), valueSelected)
					lines.push(truncateToWidth(`${prefix}${control}${label}  ${value}`, width))
				}
				lines.push(
					startIndex > 0 || endIndex < state.rows.length ? listTheme.hint(`  (${state.selectedIndex + 1}/${state.rows.length})`) : ""
				)
				return lines
			},
			invalidate: () => state.activeInput?.invalidate(),
			handleInput: (data: string) => {
				const kb = getKeybindings()
				if (kb.matches(data, "tui.input.submit")) {
					if (commitActiveInput()) done(args)
				} else if (kb.matches(data, "tui.select.up")) {
					if (!commitActiveInput()) return
					state.selectedIndex = state.selectedIndex === 0 ? state.rows.length - 1 : state.selectedIndex - 1
					updateActiveInput()
					updateFocus()
				} else if (kb.matches(data, "tui.select.down")) {
					if (!commitActiveInput()) return
					state.selectedIndex = state.selectedIndex === state.rows.length - 1 ? 0 : state.selectedIndex + 1
					updateActiveInput()
					updateFocus()
				} else if (kb.matches(data, "tui.editor.cursorRight")) {
					const row = selectedRow()
					if (state.focusPart === "include" && row && rowIncluded(row)) state.focusPart = "value"
					else if (state.focusPart === "value") handleActiveInput(data)
				} else if (kb.matches(data, "tui.editor.cursorLeft")) {
					const row = selectedRow()
					if (state.focusPart === "value" && row && rowCanInclude(row) && (!state.activeInput || inputCursor(state.activeInput) === 0))
						state.focusPart = "include"
					else if (state.focusPart === "value") handleActiveInput(data)
				} else if (data === " ") {
					const row = selectedRow()
					if (!row) return
					const choices = rowChoices(row)
					if (state.focusPart === "include") toggleInclude()
					else if (choices) {
						const current = formatArgValue(hasAt(args, row.path) ? getAt(args, row.path) : OMIT)
						setRowValueFromLabel(row, choices[(choices.indexOf(current) + 1) % choices.length] ?? choices[0] ?? "null")
					} else handleActiveInput(data)
				} else if ((data === "+" || data === "=" || data === "-") && state.focusPart === "value" && state.activeInput)
					handleActiveInput(data)
				else if (data === "+" || data === "=") addArrayItemForSelection()
				else if (data === "-") removeSelectedArrayItem()
				else if (kb.matches(data, "tui.select.cancel")) done(undefined)
				else if (state.focusPart === "value") handleActiveInput(data)
			}
		}
	})
}
