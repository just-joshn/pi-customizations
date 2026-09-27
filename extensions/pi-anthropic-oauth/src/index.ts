import { createProvider, type StreamOptions } from "@earendil-works/pi-ai";
import { anthropicMessagesApi } from "@earendil-works/pi-ai/api/anthropic-messages.lazy";
import { anthropicProvider } from "@earendil-works/pi-ai/providers/anthropic";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const PROVIDER_ID = "claude-subscription";

// Anthropic's subscription gateway attributes a request to the Claude Code plan
// by this first system block. Without it the request is billed against extra
// usage and refused, so the captured string must stay byte-for-byte intact.
const BILLING_BLOCK = {
	type: "text",
	text: "x-anthropic-billing-header: cc_version=2.1.280.3a6; cc_entrypoint=sdk-cli;",
};

function withClaudeCodeBilling<T extends StreamOptions>(options: T | undefined): T {
	const version = options?.env?.CLAUDE_CODE_VERSION || process.env.CLAUDE_CODE_VERSION;
	return {
		...options,
		headers: version ? { "user-agent": `claude-cli/${version}`, ...options?.headers } : options?.headers,
		onPayload: async (payload, model) => {
			const params = payload as { system: unknown[] };
			const billed = { ...params, system: [BILLING_BLOCK, ...params.system] };
			return (await options?.onPayload?.(billed, model)) ?? billed;
		},
	} as T;
}

export default function (pi: ExtensionAPI) {
	const anthropic = anthropicProvider();
	const messages = anthropicMessagesApi();
	pi.registerProvider(
		createProvider({
			id: PROVIDER_ID,
			name: "Claude subscription",
			baseUrl: anthropic.baseUrl,
			auth: { oauth: { ...anthropic.auth.oauth!, name: "Claude subscription (Claude Code)" } },
			models: anthropic.getModels().map((model) => ({ ...model, provider: PROVIDER_ID })),
			api: {
				stream: (model, context, options) => messages.stream(model, context, withClaudeCodeBilling(options)),
				streamSimple: (model, context, options) =>
					messages.streamSimple(model, context, withClaudeCodeBilling(options)),
			},
		}),
	);
}
