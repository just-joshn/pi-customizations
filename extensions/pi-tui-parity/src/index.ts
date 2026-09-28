import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { installFooter } from './chrome/footer.ts';
import { installHeader } from './chrome/header.ts';
import { installWorkingIndicator } from './chrome/working.ts';
import { installCommands } from './commands/register.ts';
import { createAllowlist, installDecisionGate } from './decisions/gate.ts';
import { installEditor } from './editor/install.ts';
import { installNotifications } from './notify/osc.ts';
import { installPagers } from './pagers/pagers.ts';
import { createSessionState } from './state.ts';
import { registerToolRenderers } from './tools/renderers.ts';
import { registerTodosTool } from './tools/todos.ts';
import { installRuleWizard } from './wizard/rule.ts';

export default function (pi: ExtensionAPI) {
  const state = createSessionState();
  const allowlist = createAllowlist();
  installHeader(pi);
  installFooter(pi, state);
  installWorkingIndicator(pi);
  installEditor(pi, state);
  registerToolRenderers(pi);
  registerTodosTool(pi);
  installDecisionGate(pi, state, allowlist);
  installCommands(pi, state);
  installPagers(pi);
  installNotifications(pi);
  installRuleWizard(pi);
}
