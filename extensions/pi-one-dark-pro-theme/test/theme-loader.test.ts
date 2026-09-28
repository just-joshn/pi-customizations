// biome-ignore-all lint/security/noSecrets: the literals below are truecolor escape sequences, not secrets.
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { describe, expect, it } from "vitest";
import { THEME_NAME, themeSchemaPath } from "../parity/theme.ts";

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const themePath = join(packageRoot, "themes", `${THEME_NAME}.json`);
const loaderPath = join(dirname(themeSchemaPath(packageRoot)), "theme.js");

// The loader lives in the vendored pi install. A checkout without devDependencies skips this
// suite instead of failing, so the artifact check stays honest about what it could not run.
const vendored = existsSync(loaderPath);

interface LoadedTheme {
	readonly name: string;
	fg(role: string, text: string): string;
	bg(role: string, text: string): string;
}

interface ThemeModule {
	loadThemeFromPath(path: string, mode: string): LoadedTheme;
}

async function loadVendoredTheme(): Promise<LoadedTheme> {
	const module = (await import(pathToFileURL(loaderPath).href)) as ThemeModule;
	return module.loadThemeFromPath(themePath, "truecolor");
}

describe.skipIf(!vendored)("theme loader through the vendored pi copy", () => {
	it("loads the committed theme by name", async () => {
		const theme = await loadVendoredTheme();
		expect(theme.name).toBe("one-dark-pro-flat");
	});

	it("renders the syntax keyword role", async () => {
		const theme = await loadVendoredTheme();
		expect(theme.fg("syntaxKeyword", "x")).toBe(
			"\u001b[38;2;198;120;221mx\u001b[39m",
		);
	});

	it("renders the accent role", async () => {
		const theme = await loadVendoredTheme();
		expect(theme.fg("accent", "x")).toBe("\u001b[38;2;97;175;239mx\u001b[39m");
	});

	it("renders the selected background role", async () => {
		const theme = await loadVendoredTheme();
		expect(theme.bg("selectedBg", "x")).toBe(
			"\u001b[48;2;64;72;89mx\u001b[49m",
		);
	});

	it("renders the top thinking role", async () => {
		const theme = await loadVendoredTheme();
		expect(theme.fg("thinkingMax", "x")).toBe(
			"\u001b[38;2;255;97;110mx\u001b[39m",
		);
	});
});

/**
 * The 17 scope-derived roles, pinned to the escape each one renders.
 *
 * Why these and not the other 42. The other 42 read a workbench key verbatim, so
 * `checkParity` comparing the committed theme against a fresh build is enough. These 17 go
 * through `resolveScope`, which is the one place a resolver bug can silently change a shipped
 * color: the generator and the gate share `buildTheme`, so a broken `resolveScope` produces a
 * self-consistent theme that the gate reports as OK. Verified by injecting a `resolveScope` that
 * always returned `#000000`; the gate stayed green and every color below went black.
 *
 * The expected values are literals on purpose. They were derived from the pinned upstream file
 * by a separate implementation before this package existed, so they are an outside opinion
 * rather than a restatement of what the resolver computes today.
 */
const SCOPE_ROLES: readonly (readonly [string, string, string])[] = [
	["mdHeading", "markup.heading", "\u001b[38;2;224;108;117m"],
	["mdLink", "string.other.link.title.markdown", "\u001b[38;2;97;175;239m"],
	["mdLinkUrl", "markup.underline.link.markdown", "\u001b[38;2;198;120;221m"],
	["mdCode", "markup.inline.raw.markdown", "\u001b[38;2;152;195;121m"],
	["mdCodeBlock", "meta.embedded", "\u001b[38;2;171;178;191m"],
	[
		"mdCodeBlockBorder",
		"punctuation.definition.raw.markdown",
		"\u001b[38;2;229;192;123m",
	],
	["mdQuote", "markup.quote.markdown", "\u001b[38;2;92;99;112m"],
	[
		"mdListBullet",
		"punctuation.definition.list.begin.markdown",
		"\u001b[38;2;229;192;123m",
	],
	["syntaxComment", "comment", "\u001b[38;2;127;132;142m"],
	["syntaxKeyword", "keyword", "\u001b[38;2;198;120;221m"],
	["syntaxFunction", "entity.name.function", "\u001b[38;2;97;175;239m"],
	["syntaxVariable", "variable", "\u001b[38;2;224;108;117m"],
	["syntaxString", "string", "\u001b[38;2;152;195;121m"],
	["syntaxNumber", "constant.numeric", "\u001b[38;2;209;154;102m"],
	["syntaxType", "entity.name.type", "\u001b[38;2;229;192;123m"],
	["syntaxOperator", "keyword.operator", "\u001b[38;2;171;178;191m"],
	[
		"syntaxPunctuation",
		"punctuation.separator.delimiter",
		"\u001b[38;2;171;178;191m",
	],
];

describe.skipIf(!vendored)(
	"scope-derived roles through the vendored pi copy",
	() => {
		it.each(SCOPE_ROLES)(
			"renders %s from %s",
			async (role, _scope, expected) => {
				const theme = await loadVendoredTheme();
				expect(theme.fg(role, "x")).toBe(`${expected}x\u001b[39m`);
			},
		);
	},
);
