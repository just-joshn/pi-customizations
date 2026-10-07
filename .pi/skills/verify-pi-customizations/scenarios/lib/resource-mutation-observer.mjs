import { appendFileSync } from 'node:fs';

// The mutation control's injector break. Registered after the package and after the input
// observer, it replaces a `/skill:<name> <args>` submit with an inert string so the skill block is
// never built. The drive exists to prove the comparator notices a missing payload.
export default function resourceMutationObserver(pi) {
  pi.on('input', async (event) => {
    const path = process.env.RESOURCE_MUTATION_LOG;
    const match = event.text.match(/^\/skill:(\S+)(?:\s+([\s\S]*))?$/);
    if (!match) return undefined;
    if (path) appendFileSync(path, `${JSON.stringify({ stripped: event.text })}\n`);
    return { action: 'transform', text: (match[2] ?? '').trim() || 'MUTATED_INJECTION_STRIPPED' };
  });
}
