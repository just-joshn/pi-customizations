import { z } from 'zod';
import { type CodeAssistCall, CodeAssistError, callCodeAssist, codeAssistUrl } from './code-assist-client.ts';
import { CODE_ASSIST_BASE_URL } from './constants.ts';
import { sleep } from './sleep.ts';

export interface ResolvedProject {
  projectId: string;
  tierId: string;
  tierName: string;
}

export interface ResolveProjectInput extends CodeAssistCall {
  envProject: string | undefined;
}

const TIER = z.object({ id: z.string().optional(), name: z.string().optional(), isDefault: z.boolean().optional() });
const INELIGIBLE_TIER = z.object({ reasonCode: z.string().optional(), reasonMessage: z.string().optional(), validationUrl: z.string().optional() });
const LOAD_CODE_ASSIST_RESPONSE = z.object({
  currentTier: TIER.nullish(),
  allowedTiers: z.array(TIER).nullish(),
  ineligibleTiers: z.array(INELIGIBLE_TIER).nullish(),
  cloudaicompanionProject: z.string().nullish(),
  paidTier: TIER.nullish(),
});
const OPERATION = z.object({
  name: z.string().optional(),
  done: z.boolean().optional(),
  response: z.object({ cloudaicompanionProject: z.object({ id: z.string().optional() }).optional() }).optional(),
  error: z.object({ message: z.string().optional() }).optional(),
});

type LoadCodeAssistResponse = z.infer<typeof LOAD_CODE_ASSIST_RESPONSE>;
type Operation = z.infer<typeof OPERATION>;

const METADATA = { ideType: 'ANTIGRAVITY' } as const;
const FREE_TIER = 'free-tier';
const LEGACY_TIER = 'legacy-tier';
const STANDARD_TIER = 'standard-tier';
const POLL_INTERVAL_MS = 5000;
const MAX_POLLS = 60;
const NUMERIC_PROJECT = /^\d+$/;

export function readProjectOverride(env: NodeJS.ProcessEnv): string | undefined {
  const value = (env['GOOGLE_CLOUD_PROJECT'] || env['GOOGLE_CLOUD_PROJECT_ID'] || '').trim();
  if (!value) return undefined;
  if (NUMERIC_PROJECT.test(value)) throw new CodeAssistError('GOOGLE_CLOUD_PROJECT must be the project ID string, not its number');
  return value;
}

function assertEligible(load: LoadCodeAssistResponse): void {
  const unsupported = load.ineligibleTiers?.find((tier) => tier.reasonCode === 'UNSUPPORTED_CLIENT');
  if (unsupported) throw new CodeAssistError(unsupported.reasonMessage ?? 'Google rejected this client (UNSUPPORTED_CLIENT).');
  const validation = load.ineligibleTiers?.find((tier) => tier.reasonCode === 'VALIDATION_REQUIRED' && tier.validationUrl);
  if (validation?.validationUrl) throw new CodeAssistError(`${validation.reasonMessage ?? 'Account validation required.'} Validate at: ${validation.validationUrl}`);
}

function missingProject(load: LoadCodeAssistResponse): CodeAssistError {
  const reasons = (load.ineligibleTiers ?? []).map((tier) => tier.reasonMessage).filter((message): message is string => Boolean(message));
  if (reasons.length > 0) return new CodeAssistError(reasons.join(', '));
  return new CodeAssistError('This account requires setting the GOOGLE_CLOUD_PROJECT or GOOGLE_CLOUD_PROJECT_ID environment variable, then running /login again');
}

export async function resolveProject(input: ResolveProjectInput): Promise<ResolvedProject> {
  const { envProject } = input;
  const metadata = { ...METADATA, ...(envProject ? { duetProject: envProject } : {}) };
  const load = await callCodeAssist(input, LOAD_CODE_ASSIST_RESPONSE, 'POST', codeAssistUrl('loadCodeAssist'), { cloudaicompanionProject: envProject, metadata });

  if (!load.currentTier) {
    assertEligible(load);
    return onboardUser(input, load, metadata);
  }
  const projectId = load.cloudaicompanionProject || envProject;
  if (!projectId) throw missingProject(load);
  return {
    projectId,
    tierId: load.paidTier?.id ?? load.currentTier.id ?? STANDARD_TIER,
    tierName: load.paidTier?.name ?? load.currentTier.name ?? '',
  };
}

/** Polls a long-running operation until Google reports it done. An unfinished operation without a name cannot be polled. */
async function pollOperation(input: ResolveProjectInput, operation: Operation, polls = 0): Promise<Operation> {
  if (operation.done) return operation;
  if (!operation.name) throw new CodeAssistError('Google Code Assist onboarding returned an incomplete operation; run /login again');
  if (polls === MAX_POLLS) throw new CodeAssistError('Google Code Assist onboarding did not finish in time; run /login again');
  await sleep(POLL_INTERVAL_MS, input.signal);
  return pollOperation(input, await callCodeAssist(input, OPERATION, 'GET', `${CODE_ASSIST_BASE_URL}/${operation.name}`), polls + 1);
}

async function onboardUser(input: ResolveProjectInput, load: LoadCodeAssistResponse, metadata: Record<string, string>): Promise<ResolvedProject> {
  const { envProject } = input;
  const tier = load.allowedTiers?.find((candidate) => candidate.isDefault) ?? { id: LEGACY_TIER, name: '' };
  const tierId = tier.id ?? STANDARD_TIER;
  // The free tier uses a managed project. Sending one makes Google answer Precondition Failed.
  const onboard = tierId === FREE_TIER ? { tierId, metadata: METADATA } : { tierId, cloudaicompanionProject: envProject, metadata };
  const started = await callCodeAssist(input, OPERATION, 'POST', codeAssistUrl('onboardUser'), onboard);
  const operation = await pollOperation(input, started);
  if (operation.error) throw new CodeAssistError(operation.error.message ?? 'Google Code Assist onboarding failed');

  const projectId = operation.response?.cloudaicompanionProject?.id || envProject;
  if (!projectId) throw missingProject(load);
  return { projectId, tierId, tierName: tier.name ?? '' };
}
