import { basename } from 'node:path';

import type { ExtensionAPI, ExtensionUIContext, Theme } from '@earendil-works/pi-coding-agent';
import type { Component } from '@earendil-works/pi-tui';
import { RuleEditor } from './editor.ts';
import { fitPlain, gutterAt, gutterOf, sanitizeLine } from './text.ts';

type EditorFactory = NonNullable<ReturnType<ExtensionUIContext['getEditorComponent']>>;
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
    ctx.ui.setHeader((_tui, theme) => new HeaderLine(theme, basename(ctx.cwd) || ctx.cwd, gutter));
    ctx.ui.setWorkingIndicator({ frames: [] });
    ctx.ui.setWorkingMessage('working');
    ctx.ui.setHiddenThinkingLabel('thinking');
    // An editor from another extension wins: Pi assigns callbacks, handlers, and border color onto the instance, so it cannot be wrapped safely.
    const previous = ctx.ui.getEditorComponent();
    if (previous && previous !== ownEditor) return;
    ownEditor = (tui, editorTheme, keybindings) => new RuleEditor(tui, editorTheme, keybindings, () => ctx.ui.theme, gutter);
    ctx.ui.setEditorComponent(ownEditor);
  });
}
export class HeaderLine implements Component {
  private cache: { width: number; lines: string[] } | undefined;
  private readonly theme: Theme;
  private readonly workspace: string;
  private readonly gutter: number;
  constructor(theme: Theme, workspace: string, gutter: number) {
    this.theme = theme;
    this.workspace = workspace;
    this.gutter = gutter;
  }
  render(width: number): string[] {
    if (this.cache?.width === width) return this.cache.lines;
    const g = gutterAt(this.gutter, width);
    const inner = width - 2 * g;
    const text = inner < 5 ? this.theme.fg('accent', fitPlain('pi', inner)) : this.theme.fg('accent', 'pi') + this.theme.fg('dim', ' / ') + this.theme.fg('muted', fitPlain(sanitizeLine(this.workspace), inner - 5));
    const lines = ['', ' '.repeat(g) + text, ''];
    this.cache = { width, lines };
    return lines;
  }
  invalidate(): void {
    this.cache = undefined;
  }
}
