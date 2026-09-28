import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { describe, expect, it } from 'vitest';
import { registerToolRenderers } from '../src/tools/renderers.ts';
import type { ToolRowState } from '../src/tools/ui.ts';
import { makeTheme } from './theme.ts';

type AnyDef = {
  name: string;
  renderCall?: (args: unknown, theme: unknown, context: unknown) => { render: (w: number) => string[] };
  renderResult?: (result: unknown, options: unknown, theme: unknown, context: unknown) => { render: (w: number) => string[] };
  execute: (id: string, params: unknown, signal: unknown, onUpdate: unknown) => Promise<unknown>;
};

const ESC = '\x1b';
const ANSI = new RegExp(`${ESC}\\[[0-9;]*m`, 'g');
const strip = (s: string) => s.replace(ANSI, '');

function capture(): Map<string, AnyDef> {
  const defs = new Map<string, AnyDef>();
  const fakePi = { registerTool: (def: AnyDef) => defs.set(def.name, def) } as unknown as ExtensionAPI;
  registerToolRenderers(fakePi);
  return defs;
}

let contextSeq = 0;

function makeContext(args: unknown): { ctx: unknown; invalidations: () => number } {
  let invalidations = 0;
  const holder: { toolCallId: string; invalidate: () => void; state: ToolRowState | undefined; args: unknown; cwd: string } = {
    toolCallId: `t${++contextSeq}`,
    invalidate: () => {
      invalidations += 1;
    },
    state: {} as ToolRowState,
    args,
    cwd: '/proj',
  };
  return { ctx: holder, invalidations: () => invalidations };
}

function result(text: string, details?: unknown): unknown {
  return { content: [{ type: 'text', text }], details };
}

describe('tui tool renderers', () => {
  it('registers all seven built-in tool renderers', () => {
    expect([...capture().keys()].sort()).toEqual(['bash', 'edit', 'find', 'grep', 'ls', 'read', 'write']);
  });

  it('read: progressive verb, path, lines note, then past verb', async () => {
    const theme = await makeTheme();
    const read = capture().get('read');
    if (!read) throw new Error('missing read');
    const { ctx } = makeContext({ path: 'x.ts', offset: 4, limit: 10 });
    const comp = read.renderCall?.({ path: 'x.ts', offset: 4, limit: 10 }, theme, ctx);
    expect(strip(comp?.render(200)[0] ?? '')).toBe(' Reading x.ts lines 5-14');
    read.renderResult?.(result('file body'), { expanded: false, isPartial: false }, theme, ctx);
    expect(strip(comp?.render(200)[0] ?? '')).toBe(' Read x.ts lines 5-14');
  });

  it('invalidates the call row once across repeated result renders', async () => {
    const theme = await makeTheme();
    const bash = capture().get('bash');
    if (!bash) throw new Error('missing bash');
    const { ctx, invalidations } = makeContext({ command: 'echo hi' });
    bash.renderCall?.({ command: 'echo hi' }, theme, ctx);
    const options = { expanded: false, isPartial: false };
    bash.renderResult?.(result('one'), options, theme, ctx);
    expect(invalidations()).toBe(1);
    bash.renderResult?.(result('two'), options, theme, ctx);
    expect(invalidations()).toBe(1);
  });

  it('edit: +N -M note from the patch and the bordered diff block', async () => {
    const theme = await makeTheme();
    const edit = capture().get('edit');
    if (!edit) throw new Error('missing edit');
    const { ctx } = makeContext({ path: '/proj/src/a.ts' });
    edit.renderCall?.({ path: '/proj/src/a.ts' }, theme, ctx);
    const patch = ['@@ -1,2 +1,2 @@', '-old line', '+new line', ' context'].join('\n');
    const comp = edit.renderResult?.(result('', { diff: '-old line\n+new line\n context', patch }), { expanded: false, isPartial: false }, theme, ctx);
    const rows = comp ? comp.render(120).map(strip) : [];
    expect(rows.map((r) => r.trimEnd())).toEqual(['  ▎ -old line', '  ▎ +new line', '  ▎  context']);
  });

  it('bash: collapsed output shows 2 lines plus the hidden hint', async () => {
    const theme = await makeTheme();
    const bash = capture().get('bash');
    if (!bash) throw new Error('missing bash');
    const { ctx } = makeContext({ command: 'echo one' });
    bash.renderCall?.({ command: 'echo one' }, theme, ctx);
    const output = ['l1', 'l2', 'l3', 'l4', 'l5'].join('\n');
    const callRow = bash.renderCall?.({ command: 'echo one' }, theme, ctx) as { render: (w: number) => string[] };
    bash.renderResult?.(result(`${output}\nexit code: 0`), { expanded: false, isPartial: false }, theme, ctx);
    const header = strip(callRow.render(200)[0] ?? '');
    expect(header.includes('$ echo one')).toBe(true);
    const callRes = bash.renderResult?.(result(`${output}\nexit code: 0`), { expanded: false, isPartial: false }, theme, ctx) as { render: (w: number) => string[] } | undefined;
    const rows = (callRes ? callRes.render(200) : []).map(strip);
    expect(rows.some((r) => r.includes('l1'))).toBe(true);
    expect(rows.some((r) => r.includes('l2'))).toBe(true);
    expect(rows.some((r) => r.includes('l3'))).toBe(false);
    expect(rows.some((r) => r.includes('… 3 output lines hidden · ctrl+o to expand'))).toBe(true);
  });

  it('bash: failure suffix carries the exit code', async () => {
    const theme = await makeTheme();
    const bash = capture().get('bash');
    if (!bash) throw new Error('missing bash');
    const { ctx } = makeContext({ command: 'false' });
    bash.renderCall?.({ command: 'false' }, theme, ctx);
    const callRow = bash.renderCall?.({ command: 'false' }, theme, ctx) as { render: (w: number) => string[] };
    bash.renderResult?.(result('boom\nexit code: 2'), { expanded: false, isPartial: false }, theme, ctx);
    const header = strip(callRow.render(200)[0] ?? '');
    expect(header.includes('exit 2')).toBe(true);
  });

  it('grep: 40-char pattern rule and Found N matches', async () => {
    const theme = await makeTheme();
    const grep = capture().get('grep');
    if (!grep) throw new Error('missing grep');
    const longPattern = `${'x'.repeat(13)}${'y'.repeat(37)}`;
    const { ctx } = makeContext({ pattern: longPattern });
    const comp = grep.renderCall?.({ pattern: longPattern }, theme, ctx);
    expect(strip(comp?.render(200)[0] ?? '').startsWith(` Grepping "...${'y'.repeat(37)}"`)).toBe(true);
    const res = grep.renderResult?.(result('a:1:x\na:2:y'), { expanded: false, isPartial: false }, theme, ctx);
    expect(
      res
        ?.render(120)
        .map((r) => strip(r).trimEnd())
        .join('\n'),
    ).toBe('  Found 2 matches');
  });

  it('find: Found N files with glob phrasing', async () => {
    const theme = await makeTheme();
    const find = capture().get('find');
    if (!find) throw new Error('missing find');
    const { ctx } = makeContext({ pattern: '*.ts' });
    find.renderCall?.({ pattern: '*.ts' }, theme, ctx);
    const res = find.renderResult?.(result('a.ts\nb.ts\nc.ts'), { expanded: false, isPartial: false }, theme, ctx);
    expect(
      res
        ?.render(120)
        .map((r) => strip(r).trimEnd())
        .join('\n'),
    ).toBe('  Found 3 files');
  });

  it('ls: files and directories note', async () => {
    const theme = await makeTheme();
    const ls = capture().get('ls');
    if (!ls) throw new Error('missing ls');
    const { ctx } = makeContext({});
    ls.renderCall?.({}, theme, ctx);
    const res = ls.renderResult?.(result('a.txt\nsrc/\nREADME.md\ndocs/'), { expanded: false, isPartial: false }, theme, ctx);
    expect(
      res
        ?.render(120)
        .map((r) => strip(r).trimEnd())
        .join('\n'),
    ).toBe('  2 files, 2 directories');
  });

  it('write: additions-only note from content lines', async () => {
    const theme = await makeTheme();
    const write = capture().get('write');
    if (!write) throw new Error('missing write');
    const { ctx } = makeContext({ path: '/proj/new.ts', content: 'a\nb\nc' });
    const comp = write.renderCall?.({ path: '/proj/new.ts', content: 'a\nb\nc' }, theme, ctx);
    expect(strip(comp?.render(200)[0] ?? '')).toBe(' Writing new.ts +3');
    write.renderResult?.(result('ok'), { expanded: false, isPartial: false }, theme, ctx);
    expect(strip(comp?.render(200)[0] ?? '')).toBe(' Wrote new.ts +3');
  });

  it('executes are delegated: bash runs a real command', async () => {
    const bash = capture().get('bash');
    if (!bash) throw new Error('missing bash');
    const out = (await bash.execute('x', { command: 'printf hi' }, undefined, undefined)) as { content: { type: string; text?: string }[] };
    expect(out.content[0]?.type === 'text' && out.content[0]?.text?.includes('hi')).toBe(true);
  });
});
