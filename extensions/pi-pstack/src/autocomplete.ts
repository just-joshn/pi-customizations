import type { AutocompleteItem, AutocompleteProvider, AutocompleteSuggestions } from '@earendil-works/pi-tui';

const COMMAND_TOKEN = /^\/([a-z0-9-]*)$/;

/** Adds the `/name` skill aliases to Pi's `/` menu; everything else is Pi's. */
export function aliasAutocomplete(current: AutocompleteProvider, aliases: ReadonlyMap<string, string>): AutocompleteProvider {
  return {
    ...(current.triggerCharacters === undefined ? {} : { triggerCharacters: current.triggerCharacters }),
    async getSuggestions(lines, cursorLine, cursorCol, options): Promise<AutocompleteSuggestions | null> {
      const base = await current.getSuggestions(lines, cursorLine, cursorCol, options);
      const token = cursorLine === 0 ? COMMAND_TOKEN.exec((lines[0] ?? '').slice(0, cursorCol))?.[1] : undefined;
      if (token === undefined) return base;
      const mine: AutocompleteItem[] = [...aliases].filter(([name]) => name.startsWith(token)).map(([name, description]) => ({ value: name, label: name, description }));
      if (mine.length === 0) return base;
      const taken = new Set(mine.map((item) => item.value));
      return { prefix: `/${token}`, items: [...mine, ...(base?.items ?? []).filter((item) => !taken.has(item.value))] };
    },
    applyCompletion: (lines, cursorLine, cursorCol, item, prefix) => current.applyCompletion(lines, cursorLine, cursorCol, item, prefix),
    ...(current.shouldTriggerFileCompletion === undefined ? {} : { shouldTriggerFileCompletion: (lines: string[], cursorLine: number, cursorCol: number) => current.shouldTriggerFileCompletion?.(lines, cursorLine, cursorCol) ?? true }),
  };
}
