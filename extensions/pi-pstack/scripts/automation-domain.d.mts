import type { TUnsafe } from 'typebox';

export type AutomationSlackTrigger = { type: 'slack.top_level'; channelId: string };
export type AutomationWebhookTrigger = { type: 'webhook'; fields: string[]; port: number };
export type AutomationTrigger = AutomationSlackTrigger | AutomationWebhookTrigger;
export type AutomationInput = {
  name: string;
  description: string;
  instructions: string;
  operationalPath?: string;
  trigger: AutomationTrigger;
  tools: string[];
};
export type AutomationDefinition = AutomationInput & { revision: string };
export const AutomationSchema: TUnsafe<AutomationInput>;
export function parseAutomation(input: unknown): AutomationDefinition;
