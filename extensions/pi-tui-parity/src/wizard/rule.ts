/**
 * generate-rule wizard parity, retargeted to pi's rule mechanism (AGENTS.md).
 * Research: source-screens.md §4 wizard (bold cyan "📝 Create Rule"
 * header, description question, scope picker Project/User Rule, name step,
 * result states). the reference CLI writes rule files in its own config directory; pi's equivalent rule
 * files are AGENTS.md (project) and <agent-dir>/AGENTS.md (user), so the
 * wizard appends a rule section there instead.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export interface WizardResult {
	readonly status: "created" | "exists" | "cancelled";
	readonly path: string;
	readonly message: string;
}

export function buildRuleSection(description: string): string {
	const lines = [
		"",
		`## Rule: ${description.split(".")[0] || description}`,
		"",
		description,
		"",
	];
	return lines.join("\n");
}

export function slugifyName(description: string): string {
	const words = description.toLowerCase().replace(/[^a-z0-9\s]/g, "").trim().split(/\s+/).slice(0, 4);
	return words.join("-") || "rule";
}

export function wizardResultMessage(result: WizardResult): string {
	if (result.status === "created") return `✓ Rule created! ${result.path} Edit the file to customize guidelines and examples.`;
	if (result.status === "exists") return `⚠️ Rule already exists: ${result.path}`;
	return "Cancelled.";
}

async function runRuleWizard(ctx: Parameters<Parameters<ExtensionAPI["registerCommand"]>[1]["handler"]>[1], state: { agentDir: string }): Promise<WizardResult> {
	const description = await ctx.ui.input("What should this rule instruct the AI to do?", "e.g., Always use TypeScript strict mode");
	if (!description) return { status: "cancelled", path: "", message: "Cancelled." };
	const scope = await ctx.ui.select("Where should this rule be saved?", ["Project Rule — Applies to this repository only", "User Rule — Applies to all your projects"]);
	if (scope === undefined) return { status: "cancelled", path: "", message: "Cancelled." };
	const suggested = slugifyName(description);
	const name = (await ctx.ui.input(`Rule filename (without .mdc extension):`)) || suggested;
	const isProject = scope.startsWith("Project");
	const target = isProject ? `${ctx.cwd}/AGENTS.md` : `${state.agentDir}/AGENTS.md`;
	const section = buildRuleSection(description);
	const { readFileSync, appendFileSync, existsSync } = await import("node:fs");
	if (existsSync(target) && readFileSync(target, "utf8").includes(`## Rule: ${description.split(".")[0] || description}`)) {
		return { status: "exists", path: target, message: wizardResultMessage({ status: "exists", path: target, message: "" }) };
	}
	appendFileSync(target, section, "utf8");
	return { status: "created", path: target, message: wizardResultMessage({ status: "created", path: target, message: "" }) };
}

export function installRuleWizard(pi: ExtensionAPI): void {
	pi.registerCommand("rule", {
		description: "Manage rules",
		handler: async (_args, ctx) => {
			const result = await runRuleWizard(ctx, { agentDir: `${process.env.HOME ?? ""}/.pi/agent` });
			ctx.ui.notify(wizardResultMessage(result), result.status === "exists" ? "warning" : "info");
		},
	});
}
