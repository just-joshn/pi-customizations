import { type ExtensionAPI, getMarkdownTheme } from '@earendil-works/pi-coding-agent';
import { Markdown } from '@earendil-works/pi-tui';

export const REPORT_MESSAGES = ['caveman-help', 'caveman-stats'] as const;

export function messageBody(content: string | readonly { type: string; text?: string }[]): string {
  return typeof content === 'string' ? content : content.flatMap((part) => (part.type === 'text' && part.text !== undefined ? [part.text] : [])).join('\n');
}

export function registerRenderers(pi: ExtensionAPI): void {
  for (const customType of REPORT_MESSAGES) {
    pi.registerMessageRenderer(customType, (message, options) => new Markdown(messageBody(message.content), options.outputPad, 0, getMarkdownTheme()));
  }
}
