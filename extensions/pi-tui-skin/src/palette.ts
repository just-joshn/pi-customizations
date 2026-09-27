/**
 * Reference-only theme tokens that pi's theme schema cannot express (56 fixed roles,
 * additionalProperties false), plus Reference's background tint mixing formula.
 *
 * Sources: source-renderer.md (themes, exact colors, tint configs, ANSI256 approximation),
 * source-composer.md (composer, user-message, /btw tints), source-conversation.md (user tints).
 */

export type HexColor = `#${string}`;

export interface TintConfig {
	readonly tint: HexColor;
	readonly ratio: number;
	readonly fallback: HexColor;
	readonly ansi256: number;
}

export interface DiffPalette {
	readonly addedRowBg: HexColor;
	readonly removedRowBg: HexColor;
	readonly addedSignFg: HexColor;
	readonly removedSignFg: HexColor;
	readonly inlineAddedBg: HexColor;
	readonly inlineAddedFg: HexColor;
	readonly inlineRemovedBg: HexColor;
	readonly inlineRemovedFg: HexColor;
}

export interface ReferenceTokens {
	readonly pagerAccent: HexColor;
	readonly decisionPurple: HexColor;
	readonly debugPink: HexColor;
	readonly green: HexColor;
	readonly greenDeep: HexColor;
	readonly userMessage: TintConfig;
	readonly userMessageFollowUp: TintConfig;
	readonly composerBg: TintConfig;
	readonly btwBar: TintConfig;
	readonly diff: DiffPalette;
	readonly diffAnsi256: {
		readonly rowAdd: number;
		readonly rowRemove: number;
		readonly signAdd: number;
		readonly signRemove: number;
		readonly inlineAddBg: number;
		readonly inlineAddFg: number;
		readonly inlineRemoveBg: number;
		readonly inlineRemoveFg: number;
	};
	readonly editDiffBorder: HexColor;
}

export const REFERENCE_TOKENS: Record<"reference-dark" | "reference-light", ReferenceTokens> = {
	"reference-dark": {
		pagerAccent: "#F4E7A1",
		decisionPurple: "#A78BFA",
		debugPink: "#E34671",
		green: "#58D68D",
		greenDeep: "#167A47",
		userMessage: { tint: "#555566", ratio: 0.82, fallback: "#242428", ansi256: 235 },
		userMessageFollowUp: { tint: "#6a6040", ratio: 0.78, fallback: "#2e2818", ansi256: 94 },
		composerBg: { tint: "#505050", ratio: 0.95, fallback: "#151515", ansi256: 233 },
		btwBar: { tint: "#707070", ratio: 0.9, fallback: "#333333", ansi256: 236 },
		diff: {
			addedRowBg: "#2b3f2b",
			removedRowBg: "#402626",
			addedSignFg: "#3fb950",
			removedSignFg: "#f85149",
			inlineAddedBg: "#2E5A2E",
			inlineAddedFg: "#d1d7e0",
			inlineRemovedBg: "#5A2E2E",
			inlineRemovedFg: "#d1d7e0",
		},
		diffAnsi256: { rowAdd: 22, rowRemove: 52, signAdd: 2, signRemove: 1, inlineAddBg: 22, inlineAddFg: 252, inlineRemoveBg: 52, inlineRemoveFg: 252 },
		editDiffBorder: "#3E3E40",
	},
	"reference-light": {
		pagerAccent: "#7A5A00",
		decisionPurple: "#A78BFA",
		debugPink: "#E34671",
		green: "#167A47",
		greenDeep: "#167A47",
		userMessage: { tint: "#b0b0b0", ratio: 0.82, fallback: "#e8e8e8", ansi256: 254 },
		userMessageFollowUp: { tint: "#c8b878", ratio: 0.78, fallback: "#f5efe0", ansi256: 230 },
		composerBg: { tint: "#d0d0d0", ratio: 0.9, fallback: "#f2f2f2", ansi256: 255 },
		btwBar: { tint: "#8a8a8a", ratio: 0.9, fallback: "#d6d6d6", ansi256: 252 },
		diff: {
			addedRowBg: "#D0E8C5",
			removedRowBg: "#F7D1BA",
			addedSignFg: "#15803d",
			removedSignFg: "#b91c1c",
			inlineAddedBg: "#ACEFAD",
			inlineAddedFg: "#15803d",
			inlineRemovedBg: "#FFD0D0",
			inlineRemovedFg: "#b91c1c",
		},
		diffAnsi256: { rowAdd: 149, rowRemove: 215, signAdd: 22, signRemove: 52, inlineAddBg: 157, inlineAddFg: 22, inlineRemoveBg: 217, inlineRemoveFg: 52 },
		editDiffBorder: "#9C9C9E",
	},
};

export function isReferenceTheme(name: string | undefined): name is "reference-dark" | "reference-light" {
	return name === "reference-dark" || name === "reference-light";
}

export function getTokens(themeName: string | undefined): ReferenceTokens {
	return isReferenceTheme(themeName) ? REFERENCE_TOKENS[themeName] : REFERENCE_TOKENS["reference-dark"];
}

export function channelBrightness(rgb: readonly [number, number, number]): number {
	const [r, g, b] = rgb;
	return (0.2126 * r) / 255 + (0.7152 * g) / 255 + (0.0722 * b) / 255;
}

export function isLightBackground(rgb: readonly [number, number, number]): boolean {
	return channelBrightness(rgb) > 0.6;
}

export function effectiveRatio(configuredRatio: number, brightness: number): number {
	return Math.max(0.5, configuredRatio - (0.18 * Math.abs(brightness - 0.5)) / 0.5);
}

export function mixTint(background: readonly [number, number, number], tint: readonly [number, number, number], configuredRatio: number): [number, number, number] {
	const ratio = effectiveRatio(configuredRatio, channelBrightness(background));
	return [0, 1, 2].map((i) => Math.round(background[i] * ratio + tint[i] * (1 - ratio))) as [number, number, number];
}

const XTERM_256_RGB: readonly (readonly [number, number, number])[] = build256Palette();

function build256Palette(): readonly (readonly [number, number, number])[] {
	const palette: [number, number, number][] = [];
	for (let i = 0; i < 240; i++) {
		if (i < 216) {
			const r = Math.floor(i / 36);
			const g = Math.floor((i % 36) / 6);
			const b = i % 6;
			const v = (n: number) => (n === 0 ? 0 : 55 + n * 40);
			palette.push([v(r), v(g), v(b)]);
		} else {
			const v = 8 + (i - 216) * 10;
			palette.push([v, v, v]);
		}
	}
	return palette;
}

export function nearestAnsi256(rgb: readonly [number, number, number]): number {
	let best = 16;
	let bestDistance = Number.POSITIVE_INFINITY;
	for (let i = 0; i < XTERM_256_RGB.length; i++) {
		const c = XTERM_256_RGB[i];
		const d = (c[0] - rgb[0]) ** 2 + (c[1] - rgb[1]) ** 2 + (c[2] - rgb[2]) ** 2;
		if (d < bestDistance) {
			bestDistance = d;
			best = 16 + i;
		}
	}
	return best;
}

export function parseHex(hex: string): [number, number, number] {
	const h = hex.replace(/^#/, "");
	return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

export type ColorMode = "truecolor" | "256color";

function sgr(code: string, text: string): string {
	return `\x1b[${code}m${text}\x1b[0m`;
}

export function paletteFg(hex: HexColor, mode: ColorMode, text: string): string {
	const rgb = parseHex(hex);
	if (mode === "truecolor") return sgr(`38;2;${rgb[0]};${rgb[1]};${rgb[2]}`, text);
	return sgr(`38;5;${nearestAnsi256(rgb)}`, text);
}

export function paletteBg(hex: HexColor, mode: ColorMode, text: string): string {
	const rgb = parseHex(hex);
	if (mode === "truecolor") return sgr(`48;2;${rgb[0]};${rgb[1]};${rgb[2]}`, text);
	return sgr(`48;5;${nearestAnsi256(rgb)}`, text);
}
