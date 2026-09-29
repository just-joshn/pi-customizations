import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { installFooter } from './chrome/footer.ts';
import { installHeader } from './chrome/header.ts';
import { installWorkingIndicator } from './chrome/working.ts';
import { installCommands } from './commands/register.ts';
import { createAllowlist, installDecisionGate } from './decisions/gate.ts';
import { installEditor } from './editor/install.ts';
import { installNotifications } from './notify/osc.ts';
import { installPagers } from './pagers/pagers.ts';
import { createSession } from './state.ts';
import { registerToolRenderers } from './tools/renderers.ts';
import { registerTodosTool } from './tools/todos.ts';
import { installRuleWizard } from './wizard/rule.ts';

export default function (pi: ExtensionAPI) {
  const session = createSession();
  const allowlist = createAllowlist();
  installHeader(pi);
  installFooter(pi, session);
  installWorkingIndicator(pi);
  installEditor(pi, session);
  registerToolRenderers(pi);
  registerTodosTool(pi);
  installDecisionGate(pi, session, allowlist);
  installCommands(pi, session);
  installPagers(pi);
  installNotifications(pi);
  installRuleWizard(pi);
}
