/**
 * The one confirmation port every repair question goes through. Auto-yes
 * answers without prompting, and a session without an interactive UI answers
 * yes for the reference's reason: a non-interactive input path treats EOF as
 * the prompt default, and every repair prompt defaults to yes.
 */

export interface ConfirmUi {
  readonly hasUI: boolean;
  readonly confirm: (question: string, detail: string) => Promise<boolean>;
}

export function makeConfirm(ui: ConfirmUi, yesAlways: boolean): (question: string) => Promise<boolean> {
  return async (question) => {
    if (yesAlways || !ui.hasUI) return true;
    return ui.confirm(question, '');
  };
}
