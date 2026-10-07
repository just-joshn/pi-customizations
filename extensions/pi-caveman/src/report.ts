import type { ExtensionAPI, ExtensionContext } from '@earendil-works/pi-coding-agent';

type Level = 'info' | 'warning' | 'error';

// Print and JSON modes have no UI, and stdout carries the reply or the event stream there,
// so headless reports go to stderr as upstream's Pi runtime does for its notices.
export function notify(ctx: ExtensionContext, text: string, level: Level): void {
  if (ctx.hasUI) ctx.ui.notify(text, level);
  else process.stderr.write(`${text}\n`);
}

export async function show(pi: ExtensionAPI, ctx: ExtensionContext, customType: string, content: string): Promise<void> {
  await pi.sendMessage({ customType, content, display: true });
  if (!ctx.hasUI) process.stderr.write(`${content}\n`);
}
