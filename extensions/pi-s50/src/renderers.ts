import { type ExtensionAPI, getMarkdownTheme } from '@earendil-works/pi-coding-agent';
import { Markdown } from '@earendil-works/pi-tui';

export const S50_MESSAGE = 's50' as const;

export function messageBody(content: string | readonly { type: string; text?: string }[]): string {
  return typeof content === 'string' ? content : content.flatMap((part) => (part.type === 'text' && part.text !== undefined ? [part.text] : [])).join('\n');
}

export function registerRenderers(pi: Pick<ExtensionAPI, 'registerMessageRenderer'>): void {
  pi.registerMessageRenderer(S50_MESSAGE, (message, options) => new Markdown(messageBody(message.content), options.outputPad, 0, getMarkdownTheme()));
}
