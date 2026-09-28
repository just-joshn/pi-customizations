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
		const dirPath = tmp.tmpdir() + `/rule-wizard-test-${Date.now()}`;
		dir.mkdirSync(dirPath, { recursive: true });
		const target = `${dirPath}/AGENTS.md`;
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
				notify: (message: string) => {
					calls.push(`notify:${message}`);
				},
			},
		};
		const wizardModule = await import("../src/wizard/rule.ts");
		vi.stubEnv("HOME", dirPath);
		await registered.get("rule")!.handler("", ctx);
		expect(calls[0]!.startsWith("input:What should this rule instruct")).toBe(true);
		expect(calls.some((c) => c.startsWith("select:Where should this rule be saved?:2"))).toBe(true);
		expect(dir.existsSync(target)).toBe(true);
		expect(dir.readFileSync(target, "utf8").includes("## Rule: Always use consistent indentation")).toBe(true);
		const notify = calls.find((c) => c.startsWith("notify:✓"));
		expect(notify).toBeDefined();
		void wizardModule;
	});
});
