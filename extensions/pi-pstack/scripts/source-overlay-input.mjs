import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';

const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
let migrations;

export async function overlayInput(path, bytes) {
  migrations ??= JSON.parse(await readFile(new URL('../docs/vitest-source-migration.json', import.meta.url), 'utf8'));
  const migration = migrations.find((record) => record.path === path);
  if (!migration?.formatEdits) return bytes;
  if (hash(bytes) !== migration.migratedSha256) throw new Error(`Formatted overlay source differs: ${path}`);
  let lines = bytes.toString('utf8').match(/[^\n]*\n|[^\n]+$/g) ?? [];
  let delta = 0;
  const inverse = migration.formatEdits.map((edit) => {
    const offset = edit.offset + delta;
    delta += edit.after.length - edit.before.length;
    return { offset, before: edit.after, after: edit.before };
  });
  for (const edit of inverse.toReversed()) {
    if (edit.offset < 0 || edit.offset > lines.length || lines.slice(edit.offset, edit.offset + edit.before.length).join('') !== edit.before.join('')) throw new Error(`Formatting inverse differs: ${path}`);
    lines = [...lines.slice(0, edit.offset), ...edit.after, ...lines.slice(edit.offset + edit.before.length)];
  }
  const adapted = Buffer.from(lines.join(''));
  if (hash(adapted) !== migration.adaptedSha256) throw new Error(`Adapted overlay source differs: ${path}`);
  return adapted;
}
