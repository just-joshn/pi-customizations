import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { installHeader } from "./chrome/header.ts";
import { installFooter } from "./chrome/footer.ts";
import { installWorkingIndicator } from "./chrome/working.ts";
import type { CursorSessionState } from "./state.ts";

export function createState(): CursorSessionState {
	return {
		mode: "default",
		customMode: undefined,
		runEverything: false,
		autoReview: false,
		vim: "insert",
		compact: true,
	};
}

export default function (pi: ExtensionAPI) {
	const state = createState();
	installHeader(pi);
	installFooter(pi, state);
	installWorkingIndicator(pi);
}
