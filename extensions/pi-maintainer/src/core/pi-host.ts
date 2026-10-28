import type { ExtensionAPI, ExtensionContext } from '@earendil-works/pi-coding-agent';
import { confirmAsk } from './confirm.ts';
import type { Host } from './host.ts';
import { isolatedExec } from './isolated-exec.ts';

export interface HostBinding {
  readonly context: () => ExtensionContext;
  readonly yes: () => boolean | null;
  readonly never: () => readonly string[];
  readonly remember: (key: string) => void;
  readonly environment: () => Readonly<Record<string, string | undefined>>;
  readonly notice: (level: 'info' | 'warning' | 'error', text: string) => void;
}

export function createHost(_pi: ExtensionAPI, binding: HostBinding): Host {
  const output = (text: string) => binding.notice('info', text);
  const error = (text: string) => binding.notice('error', text);
  return {
    output,
    error,
    warning: (text) => binding.notice('warning', text),
    confirm: (request) =>
      confirmAsk(request, {
        yes: binding.yes(),
        isNever: (key) => binding.never().includes(key),
        rememberNever: binding.remember,
        output,
        error,
        async ask(prompt) {
          const ctx = binding.context();
          ctx.signal?.throwIfAborted();
          if (!ctx.hasUI) return 'n';
          const selected = await ctx.ui.select(prompt.subject ? `${prompt.subject}\n${prompt.text}` : prompt.text, [...prompt.offered], ctx.signal ? { signal: ctx.signal } : {});
          ctx.signal?.throwIfAborted();
          return selected ?? 'n';
        },
      }),
    async select(title, choices) {
      const ctx = binding.context();
      ctx.signal?.throwIfAborted();
      return ctx.hasUI ? ctx.ui.select(title, [...choices], ctx.signal ? { signal: ctx.signal } : {}) : undefined;
    },
    async exec(request) {
      const signal = request.signal ?? binding.context().signal;
      signal?.throwIfAborted();
      return isolatedExec({ ...request, ...(signal ? { signal } : {}) }, { ...binding.environment(), ...request.env });
    },
  };
}
