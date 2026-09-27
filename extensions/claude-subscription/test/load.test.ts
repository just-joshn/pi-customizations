import assert from "node:assert/strict";
import test from "node:test";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { Provider } from "@earendil-works/pi-ai";
import extension from "../src/index.ts";

test("the extension registers a subscription provider and does not import the Anthropic SDK", () => {
	const registered: Provider[] = [];
	extension({
		registerProvider(provider: Provider) {
			registered.push(provider);
		},
	} as ExtensionAPI);
	assert.equal(registered.length, 1);
	const provider = registered[0];
	assert.equal(provider?.id, "claude-subscription");
	assert.equal(provider?.auth.oauth?.isSubscription, true);
	assert.equal(provider?.auth.oauth?.name, "Claude subscription (Provider CLI)");
	assert.equal((provider?.getModels().length ?? 0) > 0, true);
	assert.equal(provider?.getModels().every((item) => item.api === "claude-subscription-messages"), true);
});
