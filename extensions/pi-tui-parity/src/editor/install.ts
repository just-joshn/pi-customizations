/**
 * Wires the ComposerEditor as pi's editor component in TUI mode.
 * Official pattern: ctx.ui.setEditorComponent + class extends CustomEditor
 * (docs/tui.md "Extend Pi's CustomEditor", examples modal-editor.ts).
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { ComposerEditor, type ComposerEditorHooks } from "./composer-editor.ts";
import type { TuiSessionState } from "../state.ts";

export function installEditor(pi: ExtensionAPI, state: TuiSessionState): void {
	pi.on("session_start", async (_event, ctx) => {
		if (ctx.mode !== "tui") return;
		const uiTheme = { name: ctx.ui.theme.name, getColorMode: () => ctx.ui.theme.getColorMode() };
		ctx.ui.setEditorComponent((tui, theme, keybindings) => {
			const hooks: ComposerEditorHooks = {
				theme: uiTheme,
				state,
				hasConversation: () => ctx.sessionManager.getBranch().some((e) => (e as { type?: string }).type === "message"),
			};
			return new ComposerEditor(tui, theme, keybindings, hooks);
		});
	});
}
