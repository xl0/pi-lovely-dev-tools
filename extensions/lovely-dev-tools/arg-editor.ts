import { type ExtensionCommandContext, getSettingsListTheme, type ToolInfo } from "@earendil-works/pi-coding-agent"
import { getKeybindings, Input, truncateToWidth, visibleWidth } from "@earendil-works/pi-tui"
import {
	asSchema,
	coerceValue,
	defaultObjectValue,
	defaultValue,
	inputValue,
	isRecord,
	OMIT,
	OMIT_LABEL,
	objectSchemaHasProperties,
	parseJsonValue,
	type Schema,
	schemaDescription,
	schemaEnum,
	schemaStringArray,
	schemaType,
	valueLabel,
	wrapText
} from "./schema"

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

export async function editToolArgs(ctx: ExtensionCommandContext, tool: ToolInfo): Promise<Record<string, unknown> | undefined> {
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
			input.setValue(inputValue(hasAt(args, row.path) ? getAt(args, row.path) : OMIT))
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
				} else if (data === "+" || data === "=") addArrayItemForSelection()
				else if (data === "-") removeSelectedArrayItem()
				else if (kb.matches(data, "tui.select.cancel")) done(undefined)
				else if (focusPart === "value") handleActiveInput(data)
			}
		}
	})
}
