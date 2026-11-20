import { basename } from 'node:path';

import type { ExtensionAPI, ExtensionUIContext, Theme } from '@earendil-works/pi-coding-agent';
import type { Component } from '@earendil-works/pi-tui';
import { cell } from './cell.ts';
import { createRuleEditor } from './editor.ts';
import { fitPlain, gutterAt, gutterOf, sanitizeLine } from './text.ts';

type EditorFactory = NonNullable<ReturnType<ExtensionUIContext['getEditorComponent']>>;
const HEADER_MIN_INNER = 5;
const MARKDOWN_START = /^(?: {4}|\t|\s*(?:[#>`~|*+-]|\d+[.)]))/;

export function markUserPrompt(markdown: string): string {
  return !markdown.trim() || MARKDOWN_START.test(markdown) ? markdown : `› ${markdown}`;
}

export default function chrome(pi: ExtensionAPI): void {
  let ownEditor: EditorFactory | undefined;
  pi.registerMarkdownTransformer(markUserPrompt, { messageTypes: ['user'] });
  pi.on('session_start', (_event, ctx) => {
    if (!ctx.hasUI) return;
    const gutter = gutterOf(pi);
    ctx.ui.setHeader((_tui, theme) => headerLine(theme, basename(ctx.cwd) || ctx.cwd, gutter));
    ctx.ui.setWorkingIndicator({ frames: [] });
    ctx.ui.setWorkingMessage('working');
    ctx.ui.setHiddenThinkingLabel('thinking');
    // An editor from another extension wins: Pi assigns callbacks, handlers, and border color onto the instance, so it cannot be wrapped safely.
    const previous = ctx.ui.getEditorComponent();
    if (previous && previous !== ownEditor) return;
    ownEditor = (tui, editorTheme, keybindings) => createRuleEditor(tui, editorTheme, keybindings, () => ctx.ui.theme, gutter);
    ctx.ui.setEditorComponent(ownEditor);
  });
}
export function headerLine(theme: Theme, workspace: string, gutter: number): Component {
  const cache = cell<{ width: number; lines: string[] } | undefined>(undefined);
  return {
    render(width: number): string[] {
      const cached = cache.read();
      if (cached?.width === width) return cached.lines;
      const g = gutterAt(gutter, width);
      const inner = width - 2 * g;
      const text = inner < HEADER_MIN_INNER ? theme.fg('accent', fitPlain('pi', inner)) : theme.fg('accent', 'pi') + theme.fg('dim', ' / ') + theme.fg('muted', fitPlain(sanitizeLine(workspace), inner - HEADER_MIN_INNER));
      const lines = ['', ' '.repeat(g) + text, ''];
      cache.write({ width, lines });
      return lines;
    },
    invalidate(): void {
      cache.write(undefined);
    },
  };
}
