import type { AutomationDefinition, AutomationInput } from './automation-domain.mjs';

export type AutomationReceipt = AutomationDefinition & {
  directory: string;
  kind: 'disabled' | 'enabled' | 'starting' | 'ready' | 'failed';
  error?: string;
};

export function prepareAutomation(root: string, input: AutomationInput, signal?: AbortSignal): Promise<AutomationReceipt>;
export function automationDefinition(directory: string): Promise<AutomationDefinition>;
export function inspectAutomation(directory: string, signal?: AbortSignal): Promise<AutomationReceipt>;
export function saveAutomation(
  directory: string,
  input: AutomationInput,
  expectedRevision: string,
  signal?: AbortSignal,
): Promise<AutomationReceipt>;
export function threadSafetyReceipt(directory: string): Promise<Record<string, unknown> | undefined>;
export function recordThreadSafety(
  directory: string,
  revision: string,
  checks: Record<string, boolean>,
  signal?: AbortSignal,
): Promise<Record<string, unknown>>;
export function enableAutomation(
  directory: string,
  revision: string,
  signal?: AbortSignal,
): Promise<AutomationReceipt>;
export function disableAutomation(directory: string, signal?: AbortSignal): Promise<AutomationReceipt>;
