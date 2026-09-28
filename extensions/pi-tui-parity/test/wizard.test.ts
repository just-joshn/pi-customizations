import { describe, it, expect, vi } from "vitest";
import { buildRuleSection, installRuleWizard, slugifyName, wizardResultMessage } from "../src/wizard/rule.ts";

describe("rule wizard", () => {
	it("slugifies the first four words like the the reference CLI prefill", () => {
		expect(slugifyName("Always use TypeScript strict mode everywhere")).toBe("always-use-typescript-strict");
		expect(slugifyName("!!")).toBe("rule");
	});

	it("builds a rule section for AGENTS.md", () => {
		const section = buildRuleSection("Always use TypeScript strict mode.");
		expect(section.includes("## Rule: Always use TypeScript strict mode")).toBe(true);
		expect(section.includes("Always use TypeScript strict mode.")).toBe(true);
	});

	it("formats the the reference CLI result states", () => {
		expect(wizardResultMessage({ status: "created", path: "/p/AGENTS.md", message: "" })).toBe("✓ Rule created! /p/AGENTS.md Edit the file to customize guidelines and examples.");
		expect(wizardResultMessage({ status: "exists", path: "/p/AGENTS.md", message: "" })).toBe("⚠️ Rule already exists: /p/AGENTS.md");
		expect(wizardResultMessage({ status: "cancelled", path: "", message: "" })).toBe("Cancelled.");
	});

	it("registers /rule and drives the wizard through pi dialogs", async () => {
		const registered: Map<string, { handler: (args: string, ctx: unknown) => Promise<void> }> = new Map();
		const calls: string[] = [];
		const dir = await import("node:fs");
		const tmp = await import("node:os");
		const dirPath = dir.mkdtempSync(`${tmp.tmpdir()}/rule-wizard-test-`);
		const target = `${dirPath}/AGENTS.md`;
		try {
			const fakePi = {
				registerCommand: (id: string, def: { handler: (args: string, ctx: unknown) => Promise<void> }) => registered.set(id, def),
			} as never;
			installRuleWizard(fakePi);
			expect(registered.has("rule")).toBe(true);
			const ctx = {
				cwd: dirPath,
				ui: {
					input: async (title: string, placeholder?: string) => {
						calls.push(`input:${title}:${placeholder ?? ""}`);
						return "Always use consistent indentation.";
					},
					select: async (title: string, options: string[]) => {
						calls.push(`select:${title}:${options.length}`);
						return options[0];
					},
					notify: (message: string, type: string) => {
						calls.push(`notify:${type}:${message}`);
					},
				},
			};
			vi.stubEnv("HOME", dirPath);
			await registered.get("rule")!.handler("", ctx);
			expect(calls[0]).toBe("input:What should this rule instruct the AI to do?:e.g., Always use TypeScript strict mode");
			expect(calls[1]).toBe("select:Where should this rule be saved?:2");
			expect(calls.at(-1)).toBe(`notify:info:✓ Rule created! ${target} Edit the file to customize guidelines and examples.`);
			expect(dir.existsSync(target)).toBe(true);
			const section = "\n## Rule: Always use consistent indentation\n\nAlways use consistent indentation.\n";
			expect(dir.readFileSync(target, "utf8")).toBe(section);
			await registered.get("rule")!.handler("", ctx);
			expect(calls.at(-1)).toBe(`notify:warning:⚠️ Rule already exists: ${target}`);
			expect(dir.readFileSync(target, "utf8")).toBe(section);
		} finally {
			dir.rmSync(dirPath, { recursive: true, force: true });
		}
	});

	it("cancels the wizard when the description or the scope is missing", async () => {
		const registered = new Map<string, { handler: (args: string, ctx: unknown) => Promise<void> }>();
		installRuleWizard({ registerCommand: (id: string, def: never) => registered.set(id, def) } as never);
		const notify = vi.fn();
		const projectScope = "Project Rule — Applies to this repository only";
		await registered.get("rule")!.handler("", { cwd: "/nonexistent", ui: { input: async () => "", select: async () => projectScope, notify } });
		expect(notify).toHaveBeenCalledWith("Cancelled.", "info");
		await registered.get("rule")!.handler("", { cwd: "/nonexistent", ui: { input: async () => "Some rule", select: async () => undefined, notify } });
		expect(notify).toHaveBeenCalledWith("Cancelled.", "info");
		expect(notify).toHaveBeenCalledTimes(2);
	});
});
