/**
 * Wires the SkinStyleEditor as pi's editor component in TUI mode.
 * Official pattern: ctx.ui.setEditorComponent + class extends CustomEditor
 * (docs/tui.md "Extend Pi's CustomEditor", examples modal-editor.ts).
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { SkinStyleEditor, type CursorEditorHooks } from "./reference-editor.ts";
import type { ReferenceSessionState } from "../state.ts";

export function installEditor(pi: ExtensionAPI, state: ReferenceSessionState): void {
	pi.on("session_start", async (_event, ctx) => {
		if (ctx.mode !== "tui") return;
		const uiTheme = { name: ctx.ui.theme.name, getColorMode: () => ctx.ui.theme.getColorMode() };
		ctx.ui.setEditorComponent((tui, theme, keybindings) => {
			const hooks: CursorEditorHooks = {
				theme: uiTheme,
				state,
				hasConversation: () => ctx.sessionManager.getBranch().some((e) => (e as { type?: string }).type === "message"),
			};
			return new SkinStyleEditor(tui, theme, keybindings, hooks);
		});
	});
}
