import xterm from '@xterm/headless';

const { Terminal } = xterm;

export async function renderScreen(events, { rows, cols, upToSeq = Number.POSITIVE_INFINITY }) {
  const term = new Terminal({ rows, cols, allowProposedApi: true, scrollback: 1000 });
  const write = (bytes) => new Promise((resolve) => term.write(bytes, resolve));
  for (const event of events) {
    if (event.seq > upToSeq) break;
    if (event.kind === 'output') await write(Buffer.from(event.dataB64, 'base64'));
    if (event.kind === 'resize') term.resize(event.cols, event.rows);
  }
  const buffer = term.buffer.active;
  const lines = Array.from({ length: term.rows }, (_, row) => buffer.getLine(buffer.viewportY + row)?.translateToString(true) ?? '');
  const result = { rows: term.rows, cols: term.cols, lines };
  term.dispose();
  return result;
}
