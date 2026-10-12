import type { AutocompleteItem, AutocompleteProvider } from '@earendil-works/pi-tui';
import { describe, expect, test } from 'vitest';
import { aliasAutocomplete } from '../src/autocomplete.ts';

const builtin: AutocompleteItem[] = [
  { value: 'skill:poteto-mode', label: 'skill:poteto-mode' },
  { value: 'model', label: 'model' },
];
const current: AutocompleteProvider = {
  getSuggestions: async (lines, _line, col) => ((lines[0] ?? '').slice(0, col).startsWith('/') ? { items: builtin, prefix: (lines[0] ?? '').slice(0, col) } : null),
  applyCompletion: (lines, cursorLine, _col, item, prefix) => ({ lines: [`/${item.value} `, ...lines.slice(1)], cursorLine, cursorCol: prefix.length }),
};
const aliases = new Map([
  ['poteto-mode', "poteto's agent style"],
  ['poteto-help', 'Guides users through pstack'],
  ['how', 'Explains how code works'],
]);
const signal = new AbortController().signal;

describe('alias autocomplete (CMD-003)', () => {
  test('lists matching pstack skills under their Cursor names ahead of the built-in suggestions', async () => {
    const provider = aliasAutocomplete(current, aliases);
    expect(await provider.getSuggestions(['/pot'], 0, 4, { signal })).toEqual({
      prefix: '/pot',
      items: [{ value: 'poteto-mode', label: 'poteto-mode', description: "poteto's agent style" }, { value: 'poteto-help', label: 'poteto-help', description: 'Guides users through pstack' }, ...builtin],
    });
  });

  test('leaves completions alone outside a leading command token', async () => {
    const provider = aliasAutocomplete(current, aliases);
    expect(await provider.getSuggestions(['/how why'], 0, 8, { signal })).toEqual({ items: builtin, prefix: '/how why' });
    expect(await provider.getSuggestions(['say /pot'], 0, 8, { signal })).toEqual(null);
  });

  test('applies an alias like any command completion', () => {
    const provider = aliasAutocomplete(current, aliases);
    expect(provider.applyCompletion(['/pot'], 0, 4, { value: 'poteto-mode', label: 'poteto-mode' }, '/pot')).toEqual({ lines: ['/poteto-mode '], cursorLine: 0, cursorCol: 4 });
  });
});
