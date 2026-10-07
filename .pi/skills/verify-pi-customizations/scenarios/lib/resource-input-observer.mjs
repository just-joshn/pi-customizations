import { appendFileSync } from 'node:fs';

// Registered after the package under test, so `event.text` is what survives the package's own
// input transforms. The pstack re-quote is only observable here; it leaves no trace in the
// expanded prompt.
export default function resourceInputObserver(pi) {
  pi.on('input', (event) => {
    const path = process.env.RESOURCE_INPUT_LOG;
    if (!path) return;
    appendFileSync(path, `${JSON.stringify({ source: event.source, text: event.text })}\n`);
  });
}
