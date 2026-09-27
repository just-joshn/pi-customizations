import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { createSessionState } from "./state.ts";
import { installHeader } from "./chrome/header.ts";
import { installFooter } from "./chrome/footer.ts";
import { installWorkingIndicator } from "./chrome/working.ts";
import { registerCursorTools } from "./tools/renderers.ts";
import { registerTodosTool } from "./tools/todos.ts";
import { createAllowlist, installDecisionGate } from "./decisions/gate.ts";
import { installEditor } from "./editor/install.ts";
import { installCommands } from "./commands/register.ts";
import { installPagers } from "./pagers/pagers.ts";

export default function (pi: ExtensionAPI) {
	const state = createSessionState();
	const allowlist = createAllowlist();
	installHeader(pi);
	installFooter(pi, state);
	installWorkingIndicator(pi);
	installEditor(pi, state);
	registerCursorTools(pi);
	registerTodosTool(pi);
	installDecisionGate(pi, state, allowlist);
	installCommands(pi, state);
	installPagers(pi);
}
