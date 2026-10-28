import type { EditFormatName } from '../feature.ts';

export type PhysicalModelRef = { readonly provider: string; readonly id: string };

/**
 * Aider `cmd_model` format choice: keep an explicit format, otherwise adopt the
 * new model's packaged default (`commands.py:103-110`).
 */
export function editFormatAfterModelSwitch(input: { readonly current: EditFormatName; readonly oldModelDefault: EditFormatName; readonly newModelDefault: EditFormatName }): EditFormatName {
  return input.current === input.oldModelDefault ? input.newModelDefault : input.current;
}

/** Aider `cmd_model` keeps editor and weak models while replacing the main model. */
export function rolesAfterMainModelSwitch(input: { readonly editor: PhysicalModelRef | null; readonly weak: PhysicalModelRef | null; readonly nextMain: PhysicalModelRef }): {
  readonly main: PhysicalModelRef;
  readonly editor: PhysicalModelRef | null;
  readonly weak: PhysicalModelRef | null;
} {
  return { main: input.nextMain, editor: input.editor, weak: input.weak };
}

/** Aider `cmd_editor_model` keeps main and weak models while replacing the editor model. */
export function rolesAfterEditorModelSwitch(input: { readonly main: PhysicalModelRef; readonly weak: PhysicalModelRef | null; readonly nextEditor: PhysicalModelRef }): {
  readonly main: PhysicalModelRef;
  readonly editor: PhysicalModelRef;
  readonly weak: PhysicalModelRef | null;
} {
  return { main: input.main, editor: input.nextEditor, weak: input.weak };
}

/** Aider `cmd_weak_model` keeps main and editor models while replacing the weak model. */
export function rolesAfterWeakModelSwitch(input: { readonly main: PhysicalModelRef; readonly editor: PhysicalModelRef | null; readonly nextWeak: PhysicalModelRef }): {
  readonly main: PhysicalModelRef;
  readonly editor: PhysicalModelRef | null;
  readonly weak: PhysicalModelRef;
} {
  return { main: input.main, editor: input.editor, weak: input.nextWeak };
}
