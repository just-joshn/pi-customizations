import type { ExtensionFactory } from '@earendil-works/pi-coding-agent';
import { Type } from 'typebox';
import type { AgentDefinition } from './definitions.ts';
import { envFlag, flaggedNote, indentReport, provenanceFrame, scanOutput } from './output-trust.ts';

export const handbackToolName = 'SubagentHandback';
export const maxHandbackBounces = 3;
export type HandbackOutcome = 'send' | 'flagged' | 'withheld';
export type HandbackReport = Readonly<{ text: string; warning?: string }>;
export type HandbackState = Readonly<{ recipient: string; delivered: boolean; flagged: boolean; bounces: number; waitingOnBackground: boolean; report?: HandbackReport }>;
type Delivery = Readonly<{ success: boolean; message: string }>;
type Send = (content: string, flagged: boolean) => boolean;

const reportLead = `Your final report is delivered through ${handbackToolName}`;
const toolDescription = 'Deliver your final report to the agent that spawned you: the only way it reaches them. The call ends your run, so make it your last.';
const alreadyDelivered = `Nothing was sent: your report was already delivered (${handbackToolName} delivers one report). Use SendMessage for anything further, then stop.`;

export function handbackActive(definition: Pick<AgentDefinition, 'permissionMode'> | undefined, env: NodeJS.ProcessEnv = process.env): boolean {
  return definition?.permissionMode === 'auto' && envFlag(env, 'CLAUDE_CODE_SENDMESSAGE_HANDBACK', true);
}

export function handbackInstruction(): string {
  return `${reportLead}: when your work is complete, call ${handbackToolName}({message: <your full report>}). The call ends your run, so make it your last step. Only a ${handbackToolName} call reaches your caller as your result; plain text you write at the end is not delivered.`;
}

export function handbackReminder(): string {
  return `<system-reminder>\n${handbackInstruction()}\n</system-reminder>`;
}

export function handbackUnavailable(): string {
  return `${handbackToolName} is not available in this run: an earlier instruction to report through it no longer applies. Write your final report as plain text; it will be delivered.`;
}

export function deliveredNote(flagged: boolean, sender: string): string {
  const warning = flagged ? ', under a SECURITY WARNING from auto mode — the warning above the report says why' : '';
  return `This agent's report was delivered to you as a message from "${sender}" (its ${handbackToolName} call)${warning}. Read it there; it is not repeated here.\n`;
}

export const waitingNote = `This agent has not reported yet: it is waiting on its own background work and will deliver its report through ${handbackToolName} when that finishes.\n`;

export function withheldNote(canResume: boolean): string {
  return `The subagent ended without delivering a report through ${handbackToolName}, so no report was delivered. Its unsent text is not shown.${canResume ? ' Send the agent a message (SendMessage) to ask it to deliver its report.' : ''}\n`;
}

export class HandbackContract {
  private state: HandbackState;

  constructor(
    recipient: string,
    private readonly send: Send,
  ) {
    this.state = { recipient, delivered: false, flagged: false, bounces: 0, waitingOnBackground: false };
  }

  snapshot(): HandbackState {
    return this.state;
  }

  bounce(): void {
    this.state = { ...this.state, bounces: this.state.bounces + 1 };
  }

  deliver(message: string): Delivery {
    if (!message.trim()) return { success: false, message: 'message must not be empty' };
    if (this.state.delivered) return { success: false, message: alreadyDelivered };
    const scanned = scanOutput(message);
    const flagged = scanned.reportable.length > 0;
    const warning = flagged ? `SECURITY WARNING: ${flaggedNote(scanned.reportable)}` : undefined;
    const framed = provenanceFrame(scanned.out);
    if (!this.send(warning ? `${indentReport(warning)}\n${framed}` : framed, flagged)) return { success: false, message: 'Nothing was sent: the agent that spawned you is no longer running.' };
    this.state = { ...this.state, delivered: true, flagged, report: { text: scanned.out, ...(warning ? { warning } : {}) } };
    return { success: true, message: 'Report delivered to your caller.' };
  }
}

type RunOutcome = Readonly<{ status: string; output: string }>;

export async function runUntilReported<T extends RunOutcome>(contract: HandbackContract | undefined, first: () => Promise<T>, remind: (prompt: string) => Promise<T>, canContinue: () => boolean): Promise<T> {
  let outcome = await first();
  while (contract && outcome.status === 'settled' && canContinue()) {
    const state = contract.snapshot();
    if (state.delivered || state.bounces >= maxHandbackBounces) break;
    contract.bounce();
    outcome = await remind(handbackReminder());
  }
  return outcome;
}

export function handbackExtension(contract: HandbackContract): ExtensionFactory {
  return (pi) => {
    pi.registerTool({
      name: handbackToolName,
      label: handbackToolName,
      description: toolDescription,
      promptSnippet: 'Deliver your final report to the agent that spawned you',
      parameters: Type.Object({ message: Type.String({ description: 'Your full report for your caller' }) }),
      outputSchema: Type.Object({ success: Type.Boolean(), message: Type.String() }),
      execute: async (_id, params) => {
        const result = contract.deliver(params.message);
        return { content: [{ type: 'text', text: result.message }], details: result, structuredContent: result, ...(result.success ? { terminate: true } : {}) };
      },
    });
  };
}
