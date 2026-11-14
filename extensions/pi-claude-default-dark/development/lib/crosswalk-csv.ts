import { readFileSync, writeFileSync } from 'node:fs';

import Type, { type Static } from 'typebox';
import Value from 'typebox/value';

export const CrosswalkRowSchema = Type.Object({
  pi_role: Type.String(),
  pi_optional: Type.String(),
  claude_candidate_or_observation: Type.String(),
  pi_semantic_surface: Type.String(),
  pi_color_direction: Type.String(),
  mapping_class: Type.String(),
  public_renderer_required: Type.String(),
  reference_rgb: Type.String(),
  actual_rgb: Type.String(),
  parity_status: Type.String(),
  notes: Type.String(),
});
const columns = [
  'pi_role',
  'pi_optional',
  'claude_candidate_or_observation',
  'pi_semantic_surface',
  'pi_color_direction',
  'mapping_class',
  'public_renderer_required',
  'reference_rgb',
  'actual_rgb',
  'parity_status',
  'notes',
] as const satisfies readonly (keyof CrosswalkRow)[];
export type CrosswalkRow = Static<typeof CrosswalkRowSchema>;

function records(text: string): string[][] {
  const out: string[][] = [];
  let record: string[] = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (quoted) {
      if (char === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (char === '"') quoted = false;
      else field += char;
    } else if (char === '"') quoted = true;
    else if (char === ',') {
      record.push(field);
      field = '';
    } else if (char === '\n' || char === '\r') {
      if (char === '\r' && text[i + 1] === '\n') i++;
      record.push(field);
      out.push(record);
      record = [];
      field = '';
    } else field += char;
  }
  if (quoted) throw new Error('unterminated quoted field');
  if (field || record.length) out.push([...record, field]);
  return out;
}

const quote = (value: string) => (/[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value);

export function readCrosswalk(path: string): CrosswalkRow[] {
  const [header = [], ...rows] = records(readFileSync(path, 'utf8'));
  if (header.join(',') !== columns.join(',')) throw new Error(`${path}: unexpected header ${header.join(',')}`);
  return rows.map((values, index) => {
    if (values.length !== columns.length) throw new Error(`${path}: row ${index + 2} has ${values.length} fields, expected ${columns.length}`);
    const row = Object.fromEntries(columns.map((column, at) => [column, values[at] ?? '']));
    if (!Value.Check(CrosswalkRowSchema, row)) throw new Error(`${path}: row ${index + 2} does not match the crosswalk columns`);
    return row;
  });
}

export function writeCrosswalk(path: string, rows: CrosswalkRow[]): void {
  writeFileSync(path, `${columns.join(',')}\n${rows.map((row) => columns.map((column) => quote(row[column])).join(',')).join('\n')}\n`);
}
