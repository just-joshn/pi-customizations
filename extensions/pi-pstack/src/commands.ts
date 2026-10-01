import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { ExtensionAPI, ExtensionContext } from '@earendil-works/pi-coding-agent';
import { createDelivery } from './deliver.ts';
import { setupModels } from './models.ts';
import type { StateStore } from './state.ts';

const root = fileURLToPath(new URL('../', import.meta.url));
export type Skills = ReadonlyMap<string, { path: string; body: string; description: string }>;

function expand(skills: Skills, name: string, args: string) {
  const skill = skills.get(name);
  if (!skill) throw new Error(`Unknown pstack skill ${name}`);
  return `<skill name="${name}" location="${skill.path}">\nReferences are relative to ${dirname(skill.path)}.\n\n${skill.body}\n</skill>${args ? `\n\n${args}` : ''}`;
}

const isOff = (args: string) => args.trim().toLowerCase() === 'off';

function encodePromptArgument(value: string): string {
  return `'${value.replaceAll("'", "'\"'\"'")}'`;
}

function turnOff(store: StateStore, ctx: ExtensionContext) {
  store.toggle(false, ctx);
  ctx.ui.notify('Poteto mode is off.', 'info');
}

export async function setupPstack(pi: ExtensionAPI, ctx: ExtensionContext, store: StateStore) {
  if (!(await setupModels(ctx))) return false;
  if (store.read().verificationOffered) return true;
  store.update({ ...store.read(), verificationOffered: true }, ctx);
  pi.sendUserMessage(
    [
      'The user completed /setup-pstack and confirmed the model configuration. Only its optional verification step remains.',
      'Inspect this project for an existing verification skill or a harness that drives the real app. A globally installed verify skill does not establish project coverage.',
      'If there is no such project capability, offer once: "want a project-local verification skill, so agents can drive the app the way a user does and prove changes work? I can generate one with /create-verification-skill."',
      `Wait for the user to accept before invoking ${join(root, 'skills/create-verification-skill/SKILL.md')}. If a harness exists or the user declines, finish setup without creating one.`,
    ].join('\n'),
    { deliverAs: 'followUp' },
  );
  return true;
}
async function handleSetup(pi: ExtensionAPI, ctx: ExtensionContext, store: StateStore) {
  try {
    await setupPstack(pi, ctx, store);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    ctx.ui.notify(message, 'error');
    pi.sendMessage({ customType: 'pstack-setup-error', display: true, content: message });
  }
}

export function registerCommands(pi: ExtensionAPI, skills: Skills, store: StateStore): void {
  const deliver = createDelivery(pi);
  for (const [name, skill] of skills) {
    pi.registerCommand(name, {
      description: skill.description,
      handler: async (args, ctx) => {
        if (name === 'setup-pstack') {
          await handleSetup(pi, ctx, store);
          return;
        }
        if (name === 'poteto-mode') {
          if (isOff(args)) {
            turnOff(store, ctx);
            return;
          }
          store.toggle(true, ctx);
        }
        await deliver(ctx, expand(skills, name, args));
      },
    });
  }
}

export function registerNativeInput(pi: ExtensionAPI, skills: Skills, store: StateStore): void {
  pi.on('input', async (event, ctx) => {
    if (event.source === 'extension') return { action: 'continue' };
    const native = event.text.match(/^\/skill:(poteto-mode|setup-pstack)(?:\s+([\s\S]*))?$/);
    if (native) {
      const name = native[1];
      const args = native[2] ?? '';
      const discovered = pi.getCommands().find((command) => command.source === 'skill' && command.name === `skill:${name}`);
      if (!discovered || discovered.sourceInfo.path !== skills.get(name)?.path) return { action: 'continue' };
      if (name === 'setup-pstack') {
        await handleSetup(pi, ctx, store);
        return { action: 'handled' };
      }
      if (isOff(args)) {
        turnOff(store, ctx);
        return { action: 'handled' };
      }
      store.toggle(true, ctx);
      return { action: 'transform', text: expand(skills, name, args), images: event.images };
    }
    if (/^\/bro(?:\s|$)/.test(event.text)) return { action: 'continue' };
    const alias = event.text.match(/^\/([\w-]+)([\s\S]*)$/);
    if (alias && (alias[2] === '' || /^\s/.test(alias[2]))) {
      const [, name, rawSuffix] = alias;
      const suffix = rawSuffix.replace(/^\s/, '');
      const prompt = pi.getCommands().find((command) => command.name === name);
      const ownedPaths = [join(root, 'prompts', `${name}.md`), join(root, 'host', 'prompts', `${name}.md`)];
      if (prompt?.source === 'prompt' && ownedPaths.includes(prompt.sourceInfo.path) && suffix !== '') {
        return { action: 'transform', text: `/${name} ${encodePromptArgument(suffix)}`, images: event.images };
      }
    }
    return { action: 'continue' };
  });
}
