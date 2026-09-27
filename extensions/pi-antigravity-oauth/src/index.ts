import { createProvider, type Provider } from "@earendil-works/pi-ai";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { CLOUD_CODE_ENDPOINTS, PROVIDER_ID } from "./cloudcode.ts";
import { createAntigravityCommand } from "./command.ts";
import { baselineModels, createFetchModels } from "./models.ts";
import { GOOGLE_OAUTH, createAntigravityOAuth, type OAuthEndpoints } from "./oauth.ts";
import { createCloudCodeStream } from "./stream.ts";

export interface AntigravityConfig {
	endpoints: readonly string[];
	oauth: OAuthEndpoints;
}

const DEFAULT_CONFIG: AntigravityConfig = { endpoints: CLOUD_CODE_ENDPOINTS, oauth: GOOGLE_OAUTH };

export function createAntigravityProvider(config: AntigravityConfig = DEFAULT_CONFIG): Provider {
	return createProvider({
		id: PROVIDER_ID,
		name: "Google Antigravity",
		baseUrl: config.endpoints[0],
		auth: { oauth: createAntigravityOAuth(config.oauth) },
		models: baselineModels(config.endpoints[0]!),
		fetchModels: createFetchModels(config.endpoints),
		api: createCloudCodeStream(config.endpoints),
	});
}

export default function (pi: ExtensionAPI) {
	pi.registerProvider(createAntigravityProvider());
	pi.registerCommand(
		"antigravity",
		createAntigravityCommand({ cloudCode: DEFAULT_CONFIG.endpoints, userInfoUrl: DEFAULT_CONFIG.oauth.userInfoUrl }),
	);
}
