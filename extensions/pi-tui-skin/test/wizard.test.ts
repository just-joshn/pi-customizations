import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildRuleSection, installRuleWizard, slugifyName, wizardResultMessage } from "../src/wizard/rule.ts";

describe("rule wizard", () => {
	it("slugifies the first four words like the Reference prefill", () => {
		assert.equal(slugifyName("Always use TypeScript strict mode everywhere"), "always-use-typescript-strict");
		assert.equal(slugifyName("!!"), "rule");
	});

	it("builds a rule section for AGENTS.md", () => {
		const section = buildRuleSection("Always use TypeScript strict mode.");
		assert.ok(section.includes("## Rule: Always use TypeScript strict mode"));
		assert.ok(section.includes("Always use TypeScript strict mode."));
	});

	it("formats the Reference result states", () => {
		assert.equal(wizardResultMessage({ status: "created", path: "/p/AGENTS.md", message: "" }), "✓ Rule created! /p/AGENTS.md Edit the file to customize guidelines and examples.");
		assert.equal(wizardResultMessage({ status: "exists", path: "/p/AGENTS.md", message: "" }), "⚠️ Rule already exists: /p/AGENTS.md");
		assert.equal(wizardResultMessage({ status: "cancelled", path: "", message: "" }), "Cancelled.");
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
		assert.ok(registered.has("rule"));
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
		const originalAgentDir = process.env.HOME;
		process.env.HOME = dirPath;
		await registered.get("rule")!.handler("", ctx);
		process.env.HOME = originalAgentDir;
		assert.ok(calls[0]!.startsWith("input:What should this rule instruct"), calls.join("|"));
		assert.ok(calls.some((c) => c.startsWith("select:Where should this rule be saved?:2")));
		assert.ok(dir.existsSync(target), "project AGENTS.md written");
		assert.ok(dir.readFileSync(target, "utf8").includes("## Rule: Always use consistent indentation"));
		const notify = calls.find((c) => c.startsWith("notify:✓"));
		assert.ok(notify, `notify fired: ${calls.join("|")}`);
		void wizardModule;
	});
});
