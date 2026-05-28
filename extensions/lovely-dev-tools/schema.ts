import { visibleWidth } from "@earendil-works/pi-tui"

export const OMIT = Symbol("omit")
export const OMIT_LABEL = "<omit>"

export type Schema = Record<string, unknown> & {
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
export type ArgValue = unknown | typeof OMIT

export function isRecord(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === "object" && !Array.isArray(value)
}

export function asSchema(value: unknown): Schema | undefined {
	return isRecord(value) ? value : undefined
}

export function parseJsonValue(value: string): unknown | undefined {
	try {
		return JSON.parse(value)
	} catch {
		return undefined
	}
}

export function schemaStringArray(value: unknown): string[] | undefined {
	return Array.isArray(value) && value.every(item => typeof item === "string") ? value : undefined
}

function schemaArray(value: unknown): Schema[] | undefined {
	return Array.isArray(value) && value.every(isRecord) ? (value as Schema[]) : undefined
}

export function schemaEnum(schema: Schema): unknown[] | undefined {
	const ownEnum = Array.isArray(schema.enum) ? schema.enum : undefined
	if (ownEnum) return ownEnum
	const variants = schemaArray(schema.anyOf) ?? schemaArray(schema.oneOf)
	const values = variants?.map(variant => variant.const)
	return values?.every(value => value !== undefined) ? values : undefined
}

export function schemaType(schema: Schema | undefined): string {
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

export function schemaDescription(schema: Schema | undefined) {
	return typeof schema?.description === "string" ? schema.description : undefined
}

function cloneSchemaValue(value: unknown): unknown {
	if (value === null || typeof value !== "object") return value
	return JSON.parse(JSON.stringify(value)) as unknown
}

export function objectSchemaHasProperties(schema: Schema | undefined) {
	return !!asSchema(schema?.properties)
}

export function defaultObjectValue(schema: Schema | undefined): Record<string, unknown> {
	const object: Record<string, unknown> = {}
	const properties = asSchema(schema?.properties)
	const required = new Set(schemaStringArray(schema?.required) ?? [])
	if (!properties) return object
	for (const [name, rawSchema] of Object.entries(properties)) {
		if (required.has(name)) object[name] = defaultValue(asSchema(rawSchema), true)
	}
	return object
}

export function defaultValue(schema: Schema | undefined, seedArray: boolean): unknown {
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

export function valueLabel(value: ArgValue) {
	if (value === OMIT) return OMIT_LABEL
	const json = JSON.stringify(value)
	return json === undefined ? "undefined" : json
}

export function inputValue(value: ArgValue) {
	if (value === OMIT) return ""
	return valueLabel(value)
}

export function coerceValue(text: string, schema: Schema | undefined): ArgValue | undefined {
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

export function formatArgs(args: Record<string, unknown>) {
	return Object.entries(args)
		.map(([k, v]) => `${k}=${JSON.stringify(v)}`)
		.join(", ")
}

export function wrapText(text: string, width: number) {
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
