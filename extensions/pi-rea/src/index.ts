
import type { ExtensionAPI, ExtensionContext } from '@earendil-works/pi-coding-agent';
import { registerReaTools } from './registry.ts';
import { PI_REA_VERSION, ReaSession, SERVER_NAME } from './session/binary-session.ts';

const newSession = (cwd: string): ReaSession => new ReaSession({ name: SERVER_NAME, version: PI_REA_VERSION, cwd });

export const statusLines = (session: ReaSession): string[] => {
  const report = session.report();
  const availability = report['tool_availability'] as readonly { available: boolean; name: string }[];
  const implemented = availability.filter((entry) => entry.available).length;
  const target = session.target?.identity;
  return [
    `${SERVER_NAME} ${PI_REA_VERSION} · ${implemented}/${availability.length} tools available`,
    target === undefined ? 'No open target.' : `Target: ${target.path} (${target.format}, ${target.architecture ?? 'unknown arch'})`,
    `Evidence records: ${session.evidence.size} · unknown revisions: ${session.unknowns.revisionCount}`,
    'Unimplemented capabilities fail closed; parity/pi-rea/ tracks the gaps.',
  ];
};

export default function piRea(pi: ExtensionAPI): void {
  let session: ReaSession | undefined;
  const current = (): ReaSession => (session ??= newSession(process.cwd()));

  pi.on('session_start', (_event, ctx: ExtensionContext) => {
    session = newSession(ctx.cwd);
  });

  pi.on('session_shutdown', () => {
    current().closeTarget();
  });

  pi.registerCommand('rea', {
    description: 'Show pi-rea session status: target, availability and retained Evidence',
    handler: async (_arguments, ctx) => {
      ctx.ui.notify(statusLines(current()).join('\n'), 'info');
    },
  });

  registerReaTools(pi, current);
}
