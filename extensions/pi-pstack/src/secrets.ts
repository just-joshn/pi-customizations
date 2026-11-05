// Cursor's SendToUser secret request: the agent asks the user for a secret, the user types it into a masked field, and the
// value lands in the connector's credential file without ever entering the conversation. Connectors such as Slack read
// their credentials from the same files.
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import type { ExtensionAPI, ExtensionContext } from '@earendil-works/pi-coding-agent';
import type { Component, Focusable } from '@earendil-works/pi-tui';
import { Type } from 'typebox';
import { canAsk } from './modes.ts';
import { stateDir } from './paths.ts';

const CONNECTOR = /^[a-z0-9][a-z0-9-]{0,62}$/;
const FIELD = /^[A-Za-z_][A-Za-z0-9_]{0,62}$/;
const PASTE_START = '\x1b[200~';
const PASTE_END = '\x1b[201~';

export const connectorsDir = (): string => join(stateDir(), 'connectors');
export const credentialPath = (connector: string): string => join(connectorsDir(), connector, 'credentials.json');

function checkName(connector: string, field: string): void {
  if (!CONNECTOR.test(connector)) throw new Error(`connector must be lowercase letters, digits, and hyphens: "${connector}"`);
  if (!FIELD.test(field)) throw new Error(`field must be letters, digits, and underscores: "${field}"`);
}

/** One field of a connector's credentials, or undefined when it was never stored. */
export function readCredential(connector: string, field: string): string | undefined {
  const path = credentialPath(connector);
  if (!existsSync(path)) return undefined;
  const value = (JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>)[field];
  return typeof value === 'string' && value !== '' ? value : undefined;
}

/** Stores one field, keeping the connector's other fields; the file is readable by this user only. */
export function writeCredential(connector: string, field: string, value: string): string {
  checkName(connector, field);
  const path = credentialPath(connector);
  mkdirSync(join(connectorsDir(), connector), { recursive: true, mode: 0o700 });
  const current = existsSync(path) ? (JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>) : {};
  const temporary = `${path}.${process.pid}.tmp`;
  writeFileSync(temporary, `${JSON.stringify({ ...current, [field]: value }, null, 2)}\n`, { mode: 0o600 });
  renameSync(temporary, path);
  return path;
}

/** A single-line field that shows a dot per character, for typing or pasting a secret in the terminal. */
export class MaskedInput implements Component, Focusable {
  focused = false;
  private value = '';
  private pasting = false;
  private readonly title: string;
  private readonly done: (value: string | undefined) => void;
  constructor(title: string, done: (value: string | undefined) => void) {
    this.title = title;
    this.done = done;
  }

  handleInput(data: string): void {
    let rest = data;
    while (rest !== '') {
      if (rest.startsWith(PASTE_START)) {
        this.pasting = true;
        rest = rest.slice(PASTE_START.length);
        continue;
      }
      if (rest.startsWith(PASTE_END)) {
        this.pasting = false;
        rest = rest.slice(PASTE_END.length);
        continue;
      }
      const char = rest[0] ?? '';
      rest = rest.slice(1);
      if (this.pasting) {
        if (char !== '\r' && char !== '\n') this.value += char;
      } else if (char === '\r' || char === '\n') {
        this.done(this.value);
        return;
      } else if (char === '\x1b') {
        this.done(undefined);
        return;
      } else if (char === '\x7f' || char === '\b') this.value = this.value.slice(0, -1);
      else if (char === '\x15') this.value = '';
      else if (char >= ' ') this.value += char;
    }
  }

  invalidate(): void {}

  render(width: number): string[] {
    const dots = '•'.repeat(Math.min(this.value.length, Math.max(1, width - 4)));
    return [this.title.slice(0, width), `> ${dots}`.slice(0, width), 'Enter saves, Esc cancels. The value is not shown to the agent.'.slice(0, width)];
  }
}

async function askSecret(ctx: ExtensionContext, label: string): Promise<string | undefined> {
  if (ctx.mode === 'tui') return ctx.ui.custom<string | undefined>((_tui, _theme, _keys, done) => new MaskedInput(`Secret requested: ${label}`, done));
  return ctx.ui.input(`Secret requested: ${label}`, 'typed value is stored, not shown to the agent');
}

export const SecretParams = Type.Object({
  label: Type.String({ description: 'What the user is asked for, such as "webhook sender key" or "Slack bot token".' }),
  connector: Type.String({ description: 'The connector whose credential file stores the value: lowercase letters, digits, and hyphens, such as "slack" or a routine slug.' }),
  field: Type.String({ description: 'The field of that credential file, such as "token" or "key".' }),
});

const DESCRIPTION =
  "Ask the user for a secret (an API key, a token, a sender key) without it entering the conversation. The user types it into a masked field, and the value is stored in the named connector's credential file under the given field. You never see the value: read it from that file with a command that does not print it, such as jq into a config file. Never ask for a secret in chat.";

/** `onStored` runs after a value is saved, so a connector whose credential just arrived can turn its tools on. */
export function registerSecretRequest(pi: ExtensionAPI, onStored: () => void = () => undefined): void {
  pi.registerTool({
    name: 'request_secret',
    label: 'Request secret',
    description: DESCRIPTION,
    promptSnippet: 'Ask the user for a secret through a masked field; the value goes to a credential file, never to you',
    parameters: SecretParams,
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      checkName(params.connector, params.field);
      if (!canAsk(ctx)) throw new Error('Nobody can enter a secret in this run. Ask the user to run /secret in an interactive chat, or to set the value in the environment.');
      const value = await askSecret(ctx, params.label);
      if (value === undefined || value.trim() === '') return { content: [{ type: 'text', text: `The user did not provide ${params.label}. Nothing was stored.` }], details: { stored: false } };
      const path = writeCredential(params.connector, params.field, value.trim());
      onStored();
      return {
        content: [{ type: 'text', text: `Stored ${params.label} in ${path} under "${params.field}". The value is not shown here; copy it from that file with a command that does not print it.` }],
        details: { stored: true, path, connector: params.connector, field: params.field },
      };
    },
  });

  pi.registerCommand('secret', {
    description: 'Store a secret for a connector without showing it: /secret <connector> <field> [label]',
    handler: async (args, ctx) => {
      const [connector = '', field = '', ...label] = args.trim().split(/\s+/);
      try {
        checkName(connector, field);
        const value = await askSecret(ctx, label.join(' ') || `${connector} ${field}`);
        if (value === undefined || value.trim() === '') return ctx.ui.notify('Nothing stored.', 'info');
        ctx.ui.notify(`Stored in ${writeCredential(connector, field, value.trim())} under "${field}".`, 'info');
        onStored();
      } catch (error) {
        ctx.ui.notify(error instanceof Error ? error.message : String(error), 'error');
      }
      return undefined;
    },
  });
}
