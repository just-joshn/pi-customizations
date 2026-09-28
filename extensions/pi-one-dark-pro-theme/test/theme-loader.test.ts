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
		expect(theme.name).toBe(THEME_NAME);
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
