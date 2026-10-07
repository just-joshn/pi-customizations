import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

function snapshot(pi, phase, event) {
  return {
    phase,
    activeTools: pi.getActiveTools(),
    allTools: pi.getAllTools().map((tool) => ({
      name: tool.name,
      description: tool.description ?? '',
      exposure: tool.exposure ?? null,
      namespace: tool.namespace ?? null,
      sourceInfo: tool.sourceInfo ?? null,
    })),
    systemPromptSections: event?.systemPromptOptions?.sections ?? null,
  };
}

export default function pstackObserver(pi) {
  const target = process.env.PSTACK_OBSERVER_PATH;
  if (!target) return;
  const write = (phase, event) => {
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, `${JSON.stringify(snapshot(pi, phase, event), null, 2)}\n`, 'utf8');
  };
  pi.on('session_start', (_event) => write('session_start'));
  pi.on('before_agent_start', (event) => write('before_agent_start', event));
}
