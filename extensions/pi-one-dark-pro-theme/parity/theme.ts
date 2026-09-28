import { createHash } from "node:crypto";
import { join } from "node:path";
import { isDeepStrictEqual } from "node:util";

export type RoleKind = "color" | "alpha" | "scope" | "composite";

export interface RoleRow {
	readonly role: string;
	readonly kind: RoleKind;
	readonly source: string;
	readonly base: string;
	readonly why: string;
}

export interface TokenRule {
	readonly scope?: string | readonly string[];
	readonly settings: { readonly foreground?: string };
}

export interface UpstreamDocument {
	readonly name: string;
	readonly colors: Readonly<Record<string, string>>;
	readonly tokenColors: readonly TokenRule[];
}

export interface ThemeDocument {
	readonly $schema: string;
	readonly name: string;
	readonly colors: Readonly<Record<string, string>>;
	readonly export: Readonly<Record<string, string>>;
}

export const THEME_NAME = "one-dark-pro-flat";
export const UPSTREAM_SHA256 =
	// biome-ignore lint/security/noSecrets: the pinned upstream hash is published in upstream/SOURCE.md.
	"e9b4770f83a55891dcd208d7c599f2b0983c07fdcec40301249f50d0e023c656";
export const THEME_SCHEMA_URL =
	"https://raw.githubusercontent.com/earendil-works/pi/main/packages/coding-agent/src/modes/interactive/theme/theme-schema.json";

const ROLE_KINDS: readonly string[] = ["color", "alpha", "scope", "composite"];
const ROLE_MAP_HEADER = ["role", "kind", "source", "base", "why"].join("\t");
const EXPORT_PREFIX = "export.";
const COLOR_PATTERN = /^#[0-9a-f]{6}(?:[0-9a-f]{2})?$/i;

export function parseRoleMap(text: string): RoleRow[] {
	const lines = text.split("\n");
	if (lines.at(-1) === "") lines.pop();
	const rows: RoleRow[] = [];
	const seen = new Set<string>();
	for (const [index, line] of lines.entries()) {
		if (index === 0 && line === ROLE_MAP_HEADER) continue;
		const lineNumber = index + 1;
		const fields = line.split("\t");
		if (fields.length !== 5)
			throw new Error(
				`role map line ${lineNumber}: expected 5 tab-separated fields, found ${fields.length}`,
			);
		const [role = "", kind = "", source = "", base = "", why = ""] = fields;
		if (role.length === 0)
			throw new Error(`role map line ${lineNumber}: empty role`);
		if (!isRoleKind(kind))
			throw new Error(
				`role map line ${lineNumber} (${role}): "${kind}" is not a role kind`,
			);
		if (source.length === 0)
			throw new Error(`role map line ${lineNumber} (${role}): empty source`);
		if (kind !== "composite" && base.length > 0)
			throw new Error(
				`role map line ${lineNumber} (${role}): base is only allowed on composite rows`,
			);
		if (kind === "composite" && base.length === 0)
			throw new Error(
				`role map line ${lineNumber} (${role}): composite rows need a base`,
			);
		if (why.length === 0)
			throw new Error(`role map line ${lineNumber} (${role}): empty why`);
		if (seen.has(role))
			throw new Error(`role map line ${lineNumber} (${role}): duplicate role`);
		seen.add(role);
		rows.push({ role, kind, source, base, why });
	}
	return rows;
}

export function readThemeSchema(schema: unknown): {
	required: string[];
	optional: string[];
	exportProps: string[];
} {
	const root = asRecord(schema, "theme schema");
	const properties = asRecord(
		root.get("properties"),
		"theme schema properties",
	);
	const colors = asRecord(properties.get("colors"), "theme schema colors");
	const required = asStrings(
		colors.get("required"),
		"theme schema colors.required",
	);
	const colorProperties = asRecord(
		colors.get("properties"),
		"theme schema colors.properties",
	);
	const exportBlock = asRecord(properties.get("export"), "theme schema export");
	const exportProperties = asRecord(
		exportBlock.get("properties"),
		"theme schema export.properties",
	);
	for (const role of required) {
		if (!colorProperties.has(role))
			throw new Error(
				`theme schema lists required color "${role}" without a property for it`,
			);
	}
	return {
		required: [...required],
		optional: [...colorProperties.keys()].filter(
			(role) => !required.includes(role),
		),
		exportProps: [...exportProperties.keys()],
	};
}

export function themeSchemaPath(packageRoot: string): string {
	return join(
		packageRoot,
		"node_modules",
		"@earendil-works",
		"pi-coding-agent",
		"dist",
		"modes",
		"interactive",
		"theme",
		"theme-schema.json",
	);
}

export function resolveScope(
	document: UpstreamDocument,
	scopePath: string,
): string {
	if (scopePath.length === 0)
		throw new Error("resolveScope: scope path must not be empty");
	if (/\s/.test(scopePath))
		throw new Error(
			`resolveScope: scope path "${scopePath}" must be one scope name, not a parent-scope selector`,
		);
	const named = new Set<string>();
	for (const rule of document.tokenColors) {
		const foreground = rule.settings.foreground;
		if (foreground === undefined) continue;
		if (toSelectors(rule.scope).includes(scopePath))
			named.add(foreground.toLowerCase());
	}
	if (named.size === 0)
		throw new Error(
			`resolveScope: no upstream token rule names the scope "${scopePath}"`,
		);
	if (named.size > 1)
		throw new Error(
			`resolveScope: upstream names the scope "${scopePath}" more than once with different colors (${[...named].join(", ")}), so the map row has no single answer`,
		);
	return [...named][0] as string;
}

export function resolveRow(document: UpstreamDocument, row: RoleRow): string {
	const resolved = RESOLVERS[row.kind](document, row);
	if (!COLOR_PATTERN.test(resolved))
		throw new Error(
			`role ${row.role}: resolved value "${resolved}" is not a color`,
		);
	return resolved.toLowerCase();
}

export function buildTheme(
	document: UpstreamDocument,
	rows: readonly RoleRow[],
): ThemeDocument {
	const colors: Record<string, string> = {};
	const exported: Record<string, string> = {};
	for (const row of rows) {
		const target = roleTarget(row.role);
		const value = resolveRow(document, row);
		const into = target.exported ? exported : colors;
		if (into[target.key] !== undefined)
			throw new Error(`role ${row.role}: duplicate target key "${target.key}"`);
		into[target.key] = value;
	}
	return {
		$schema: THEME_SCHEMA_URL,
		name: THEME_NAME,
		colors: sortRecord(colors),
		export: sortRecord(exported),
	};
}

type RoleResolver = (document: UpstreamDocument, row: RoleRow) => string;

const RESOLVERS: Readonly<Record<RoleKind, RoleResolver>> = {
	color: (document, row) => upstreamColor(document, row.source, row.role),
	// A role pi draws as a glyph keeps its own colour rather than blending with what
	// is behind it, so a translucent key contributes its declared channels.
	alpha: (document, row) =>
		upstreamColor(document, row.source, row.role).slice(0, 7),
	scope: (document, row) => resolveScope(document, row.source),
	composite: (document, row) =>
		compositeOver(
			upstreamColor(document, row.source, row.role),
			upstreamColor(document, row.base, row.role),
			row.role,
		),
};

function isRoleKind(value: string): value is RoleKind {
	return ROLE_KINDS.includes(value);
}

function asRecord(value: unknown, label: string): Map<string, unknown> {
	if (typeof value !== "object" || value === null || Array.isArray(value))
		throw new Error(`${label} must be an object`);
	return new Map(Object.entries(value));
}

function asStrings(value: unknown, label: string): string[] {
	if (!Array.isArray(value))
		throw new Error(`${label} must be an array of strings`);
	const values: string[] = [];
	for (const item of value) {
		if (typeof item !== "string")
			throw new Error(`${label} must be an array of strings`);
		values.push(item);
	}
	return values;
}

function toSelectors(scope: TokenRule["scope"]): string[] {
	if (scope === undefined) return [];
	const items = typeof scope === "string" ? [scope] : scope;
	return items
		.flatMap((item) => item.split(","))
		.map((item) => item.trim())
		.filter((item) => item.length > 0);
}

function upstreamColor(
	document: UpstreamDocument,
	key: string,
	role: string,
): string {
	const value = document.colors[key];
	if (value === undefined)
		throw new Error(`role ${role}: upstream colors has no key "${key}"`);
	if (!COLOR_PATTERN.test(value))
		throw new Error(
			`role ${role}: upstream value "${value}" for "${key}" is not #rrggbb or #rrggbbaa`,
		);
	return value;
}

function compositeOver(over: string, base: string, role: string): string {
	if (over.length !== 9)
		throw new Error(
			`role ${role}: composite source "${over}" needs an alpha byte`,
		);
	if (base.length !== 7)
		throw new Error(
			`role ${role}: composite base "${base}" must be #rrggbb, not translucent`,
		);
	const alpha = Number.parseInt(over.slice(7, 9), 16) / 255;
	const channel = (index: number) =>
		Number.parseInt(over.slice(index, index + 2), 16) * alpha +
		Number.parseInt(base.slice(index, index + 2), 16) * (1 - alpha);
	return `#${[1, 3, 5].map((index) => Math.round(channel(index)).toString(16).padStart(2, "0")).join("")}`;
}

function roleTarget(role: string): {
	readonly key: string;
	readonly exported: boolean;
} {
	if (role.length === 0) throw new Error("role must not be empty");
	if (/\s/.test(role))
		throw new Error(`role "${role}" must not contain whitespace`);
	if (!role.startsWith(EXPORT_PREFIX)) return { key: role, exported: false };
	const key = role.slice(EXPORT_PREFIX.length);
	if (key.length === 0)
		throw new Error('an export role needs a property name after "export."');
	return { key, exported: true };
}

function sortRecord(
	values: Readonly<Record<string, string>>,
): Record<string, string> {
	return Object.fromEntries(
		Object.entries(values).sort(([left], [right]) =>
			left < right ? -1 : left > right ? 1 : 0,
		),
	);
}

export interface ParityInput {
	readonly upstreamText: string;
	readonly rows: readonly RoleRow[];
	readonly schema: {
		readonly required: string[];
		readonly optional: string[];
		readonly exportProps: string[];
	};
	readonly committed: unknown;
	readonly themeLabel: string;
}

const HEX = /^#[0-9a-f]{6}$/;

/**
 * Every way the shipped theme can disagree with the pinned upstream file and the
 * role map. Returns one message per problem, so the caller decides how to report.
 * The caller reads the files; this stays pure so each branch is testable.
 */
export function checkParity(input: ParityInput): string[] {
	const problems: string[] = [];
	const digest = createHash("sha256").update(input.upstreamText).digest("hex");
	if (digest !== UPSTREAM_SHA256)
		problems.push(
			`upstream file sha256 is ${digest}, expected ${UPSTREAM_SHA256}`,
		);

	const colors = new Set([...input.schema.required, ...input.schema.optional]);
	const exported = new Set(input.schema.exportProps);

	for (const row of input.rows) {
		if (!row.role.startsWith(EXPORT_PREFIX)) {
			if (!colors.has(row.role))
				problems.push(
					`role map role ${row.role} is not a color in the pi theme schema`,
				);
			continue;
		}
		const key = row.role.slice(EXPORT_PREFIX.length);
		if (!exported.has(key))
			problems.push(
				`role map role ${row.role} is not an export color in the pi theme schema`,
			);
	}

	const counts = new Map<string, number>();
	for (const row of input.rows)
		counts.set(row.role, (counts.get(row.role) ?? 0) + 1);
	const targets = [
		...input.schema.required,
		...input.schema.optional,
		...input.schema.exportProps.map((key) => `${EXPORT_PREFIX}${key}`),
	];
	for (const role of targets) {
		const count = counts.get(role) ?? 0;
		if (count === 0)
			problems.push(`theme schema role ${role} has no role map row`);
		else if (count > 1)
			problems.push(`theme schema role ${role} has ${count} role map rows`);
	}

	let built: ThemeDocument | undefined;
	try {
		built = buildTheme(
			JSON.parse(input.upstreamText) as UpstreamDocument,
			input.rows,
		);
	} catch (error) {
		problems.push(error instanceof Error ? error.message : String(error));
	}
	if (built === undefined) return problems;

	if (!isDeepStrictEqual(input.committed, built))
		problems.push(
			`${input.themeLabel} differs from a fresh build: ${describeThemeDifferences(input.committed, built).join("; ") || "unexpected shape"}`,
		);

	for (const section of ["colors", "export"] as const) {
		for (const [key, value] of Object.entries(built[section])) {
			if (!HEX.test(value))
				problems.push(
					`built ${section}.${key} is ${JSON.stringify(value)}, not #rrggbb`,
				);
		}
	}
	return problems;
}

function describeThemeDifferences(
	committed: unknown,
	built: ThemeDocument,
): string[] {
	const actual = (committed ?? {}) as Record<string, unknown>;
	const problems: string[] = [];
	for (const key of new Set([...Object.keys(actual), ...Object.keys(built)])) {
		if (key !== "colors" && key !== "export") {
			if (actual[key] !== built[key as keyof ThemeDocument])
				problems.push(
					`${key} is ${JSON.stringify(actual[key] ?? null)}, built ${JSON.stringify(built[key as keyof ThemeDocument])}`,
				);
			continue;
		}
		const expected = built[key];
		const got = (actual[key] ?? {}) as Record<string, string>;
		for (const entry of new Set([
			...Object.keys(expected),
			...Object.keys(got),
		])) {
			if (got[entry] !== expected[entry])
				problems.push(
					`${key}.${entry} is ${JSON.stringify(got[entry] ?? null)}, built ${JSON.stringify(expected[entry] ?? null)}`,
				);
		}
	}
	return problems;
}
