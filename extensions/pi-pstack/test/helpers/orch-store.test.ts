import { afterEach, describe, expect, test } from 'bun:test';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { openStore, type Store } from '../../skills/poteto-mode/scripts/orch/store.ts';
import { cleanDirectories, makeDirectory } from './orch-fixtures.ts';

const handles: Store[] = [];

async function fresh(): Promise<{ directory: string; store: Store }> {
  const directory = await makeDirectory();
  const store = openStore(directory);
  handles.push(store);
  await store.init();
  return { directory, store };
}

afterEach(async () => {
  for (const store of handles.splice(0)) await store.close();
  await cleanDirectories();
});

describe('orch store cell and line cleaning', () => {
  test('a track with a tab and newline is stored with spaces', async () => {
    const { store } = await fresh();
    const unit = await store.units.add({ id: 'u1', track: 'a\tb\nc\rd' });
    expect(unit.track).toBe('a b c d');
    expect((await store.units.list()).map((row) => row.track)).toEqual(['a b c d']);
  });

  test('a formula-looking id is stored with a quote prefix and found again by its raw spelling', async () => {
    const { store } = await fresh();
    const added = await store.units.add({ id: '=SUM(A1)', track: 't' });
    expect(added.id).toBe("'=SUM(A1)");
    expect((await store.units.get('=SUM(A1)')).id).toBe("'=SUM(A1)");
  });

  test('a standing order drops CR and LF, trims, and gets no formula prefix', async () => {
    const { directory, store } = await fresh();
    const item = await store.standing.add({ line: ' =a\nb ' });
    expect(item).toEqual({ number: 1, line: '=a b' });
    expect(await readFile(join(directory, 'preferences.md'), 'utf8')).toBe('1. =a b\n');
  });

  test('blank lines inside units.tsv and ledger.tsv are skipped', async () => {
    const { directory, store } = await fresh();
    await writeFile(join(directory, 'units.tsv'), 'id\ttrack\tstate\tbranch\tpr\tsha\tbrief\nu1\tt\tpending\t\t\t\t\n\nu2\tt\tpending\t\t\t\t\n');
    await writeFile(join(directory, 'ledger.tsv'), 'pr\tsha\tverdict\tevidence\tverifier\tts\n\n7\ts\ttype-check-only\te\t\t2026-01-01T00:00:00.000Z\n\n');
    expect((await store.units.list()).map((row) => row.id)).toEqual(['u1', 'u2']);
    expect(await store.ledger.summary()).toEqual({ 'type-check-only': 1 });
  });
});

describe('orch store inbox pointers', () => {
  test('peek keeps push order, ignores non-tsv files, and rejects a two-line pointer', async () => {
    const { directory, store } = await fresh();
    for (const agent of ['a', 'b', 'c']) {
      await store.inbox.push({ agent, unit: 'u', status: 'done' });
      await Bun.sleep(5);
    }
    await writeFile(join(directory, 'inbox', 'notes.txt'), 'not a pointer');
    expect((await store.inbox.peek()).map((row) => row.agent)).toEqual(['a', 'b', 'c']);
    await writeFile(join(directory, 'inbox', 'zzz.tsv'), 'ts\tagent\tunit\tstatus\treport\nsecond line\n');
    await expect(store.inbox.peek()).rejects.toThrow('inbox pointer zzz.tsv is malformed');
  });
});

describe('orch store malformed gates and standing orders', () => {
  const gate = (extra = '') => `# Gates\n\n## g1\n\n- Status: open\n- Question: q\n- Options: o\n- Default: d${extra}\n`;
  test.each([
    { name: 'a missing heading prefix', text: 'Gates\n\n## g1\n', message: 'gates.md has an invalid heading' },
    { name: 'a gate without Default', text: '# Gates\n\n## g1\n\n- Status: open\n- Question: q\n- Options: o\n', message: 'gates.md has a malformed gate g1' },
    { name: 'a resolved gate without Answer', text: gate().replace('open', 'resolved'), message: 'gates.md has invalid status resolved' },
    { name: 'an unknown status', text: gate().replace('open', 'weird'), message: 'gates.md has invalid status weird' },
    { name: 'a duplicate gate id', text: `${gate()}\n## g1\n\n- Status: open\n- Question: q\n- Options: o\n- Default: d\n`, message: 'gates.md has duplicate gate ids' },
    { name: 'a line that is not a field', text: gate('\nstray'), message: 'gates.md has a malformed gate g1' },
  ])('gates.md with $name is rejected', async ({ text, message }) => {
    const { directory, store } = await fresh();
    await writeFile(join(directory, 'gates.md'), text);
    await expect(store.gates.list()).rejects.toThrow(message);
  });

  test.each([
    { name: 'a skipped number', text: '1. a\n3. b\n' },
    { name: 'a heading', text: '# Orders\n' },
    { name: 'a bullet', text: '- a\n' },
  ])('preferences.md with $name has malformed numbering', async ({ text }) => {
    const { directory, store } = await fresh();
    await writeFile(join(directory, 'preferences.md'), text);
    await expect(store.standing.show()).rejects.toThrow('preferences.md has malformed numbering');
  });
});

describe('orch store gate transitions', () => {
  test('re-parking an open gate replaces its text, re-resolving records the new answer, and re-parking a resolved gate reopens it', async () => {
    const { store } = await fresh();
    const park = (question: string) => store.gates.park({ id: 'g', question, options: 'a|b', defaultAnswer: 'a' });
    await park('first');
    expect(await store.gates.list()).toEqual([{ kind: 'open', id: 'g', question: 'first', options: 'a|b', defaultAnswer: 'a' }]);
    await park('second');
    expect((await store.gates.list()).map((row) => row.question)).toEqual(['second']);
    expect(await store.gates.resolve({ id: 'g', answer: 'A' })).toMatchObject({ kind: 'resolved', answer: 'A' });
    expect(await store.gates.resolve({ id: 'g', answer: 'B' })).toMatchObject({ kind: 'resolved', answer: 'B' });
    expect(await store.gates.list()).toEqual([]);
    expect(await park('third')).toEqual({ kind: 'open', id: 'g', question: 'third', options: 'a|b', defaultAnswer: 'a' });
    expect((await store.gates.list()).map((row) => row.question)).toEqual(['third']);
  });
});

describe('orch store status rendering', () => {
  test('changed reports unit, ledger, frontier, and gate differences and every render stamps a new time', async () => {
    const { directory, store } = await fresh();
    await store.units.add({ id: 'u', track: 't' });
    await store.status.render();
    const first = await readFile(join(directory, 'status.md'), 'utf8');
    await Bun.sleep(5);
    await store.units.set({ id: 'u', state: 'done' });
    await store.ledger.record({ pr: 3, sha: 's', verdict: 'live-ui-verified', evidence: 'e' });
    await writeFile(join(directory, 'frontier.json'), '{"generation":1,"prs":[],"lowestUnmerged":null}\n');
    await store.gates.park({ id: 'g', question: 'a | b \\ c', options: 'o', defaultAnswer: 'd' });
    const report = await store.status.render();
    expect(report.changed).toBe('units done 0->1; units pending 1->0; ledger live-ui-verified 0->1; frontier generation 0->1; open gates 0->1');
    const second = await readFile(join(directory, 'status.md'), 'utf8');
    expect(second).toContain('| g | open | a \\| b \\\\ c | o | d |  |');
    const stamp = (text: string) => text.match(/^Generated: .*$/m)?.[0];
    expect(stamp(second)).not.toBe(stamp(first));
  });

  test('an unchanged store reports no derived changes', async () => {
    const { store } = await fresh();
    await store.status.render();
    expect((await store.status.render()).changed).toBe('no derived changes');
  });
});
