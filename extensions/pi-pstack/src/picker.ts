import { Input, SelectList, fuzzyFilter, getKeybindings, truncateToWidth } from '@earendil-works/pi-tui';
import type { ExtensionContext } from '@earendil-works/pi-coding-agent';

const visibleChoices = 10;
const listKeys = ['tui.select.up', 'tui.select.down', 'tui.select.confirm', 'tui.select.cancel'] as const;

export async function pick(ctx: ExtensionContext, title: string, choices: readonly string[]): Promise<string | undefined> {
  if (ctx.mode !== 'tui') return ctx.ui.select(title, [...choices]);
  return ctx.ui.custom<string | undefined>((tui, theme, _keybindings, done) => {
    const listTheme = {
      selectedPrefix: (text: string) => theme.fg('accent', text),
      selectedText: (text: string) => theme.fg('accent', text),
      description: (text: string) => theme.fg('muted', text),
      scrollInfo: (text: string) => theme.fg('dim', text),
      noMatch: (text: string) => theme.fg('warning', text),
    };
    const filter = new Input({ prompt: 'filter: ' });
    const build = () => {
      const items = fuzzyFilter([...choices], filter.getValue(), choice => choice).map(value => ({ value, label: value }));
      const next = new SelectList(items, visibleChoices, listTheme);
      next.onSelect = item => done(item.value);
      next.onCancel = () => done(undefined);
      return next;
    };
    let list = build();
    return {
      get focused() { return filter.focused; },
      set focused(value: boolean) { filter.focused = value; },
      render: (width: number) => [
        truncateToWidth(theme.fg('accent', theme.bold(title)), width),
        ...filter.render(width),
        ...list.render(width),
        truncateToWidth(theme.fg('dim', 'type to filter  ↑↓ navigate  enter select  escape cancel'), width),
      ],
      invalidate() { filter.invalidate(); list.invalidate(); },
      handleInput(data: string) {
        if (listKeys.some(key => getKeybindings().matches(data, key))) list.handleInput(data);
        else {
          const before = filter.getValue();
          filter.handleInput(data);
          if (filter.getValue() !== before) list = build();
        }
        tui.requestRender();
      },
    };
  });
}
