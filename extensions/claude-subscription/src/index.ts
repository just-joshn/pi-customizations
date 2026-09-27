import { createProvider } from "@earendil-works/pi-ai";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { loadModels } from "./models.ts";
import { claudeSubscriptionOAuth } from "./oauth.ts";
import { streamSubscription } from "./stream.ts";

const models = loadModels();

export default function (pi: ExtensionAPI) {
	pi.registerProvider(
		createProvider({
			id: "claude-subscription",
			name: "Claude subscription",
			baseUrl: "https://api.anthropic.com",
			auth: { oauth: claudeSubscriptionOAuth },
			models,
			api: {
				stream: streamSubscription,
				streamSimple: streamSubscription,
			},
		}),
	);
}
