import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

function snapshot(pi, phase) {
  return {
    phase,
    activeTools: pi.getActiveTools(),
    allTools: pi.getAllTools().map((tool) => ({ name: tool.name, exposure: tool.exposure ?? null, namespace: tool.namespace ?? null })),
  };
}

export default function pstackToolsObserver(pi) {
  const target = process.env.PSTACK_TOOLS_OBSERVER_PATH;
  if (!target) return;
  const write = (phase) => {
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, `${JSON.stringify(snapshot(pi, phase), null, 2)}\n`, 'utf8');
  };
  pi.on('session_start', () => write('session_start'));
  pi.on('before_agent_start', () => write('before_agent_start'));
}
