import type { FetchFunction } from '@earendil-works/pi-ai';
import { z } from 'zod';
import { ANTIGRAVITY_USER_AGENT, CODE_ASSIST_BASE_URL } from './constants.ts';

export class CodeAssistError extends Error {}

class IneligibleTierError extends CodeAssistError {}

class ValidationRequiredError extends CodeAssistError {
  constructor(reasonMessage: string, validationUrl: string) {
    super(`${reasonMessage} Validate at: ${validationUrl}`, { cause: validationUrl });
  }

  get validationUrl(): string {
    return String(this.cause);
  }
}

class ProjectRequiredError extends CodeAssistError {}

export interface ResolvedProject {
  projectId: string;
  tierId: string;
  tierName: string;
}

export interface ResolveProjectInput {
  accessToken: string;
  envProject: string | undefined;
  signal: AbortSignal;
  fetchImpl: FetchFunction;
  sleep?: (ms: number) => Promise<void>;
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
const GOOGLE_ERROR_BODY = z.object({ error: z.object({ message: z.string().min(1) }) });

export function readProjectOverride(env: NodeJS.ProcessEnv): string | undefined {
  const value = (env['GOOGLE_CLOUD_PROJECT'] || env['GOOGLE_CLOUD_PROJECT_ID'] || '').trim();
  if (!value) return undefined;
  if (/^\d+$/.test(value)) throw new CodeAssistError('GOOGLE_CLOUD_PROJECT must be the project ID string, not its number');
  return value;
}

function codeAssistUrl(method: string): string {
  return `${CODE_ASSIST_BASE_URL}:${method}`;
}

export function fetchAvailableModels(input: Pick<ResolveProjectInput, 'accessToken' | 'signal' | 'fetchImpl'> & { project: string }): Promise<unknown> {
  return callCodeAssist(input, z.json(), 'POST', codeAssistUrl('fetchAvailableModels'), { project: input.project });
}

function buildMetadata(envProject: string | undefined): Record<string, string> {
  return { ...METADATA, ...(envProject ? { duetProject: envProject } : {}) };
}

function assertEligible(load: LoadCodeAssistResponse): void {
  const unsupported = load.ineligibleTiers?.find((tier) => tier.reasonCode === 'UNSUPPORTED_CLIENT');
  if (unsupported) throw new IneligibleTierError(unsupported.reasonMessage ?? 'Google rejected this client (UNSUPPORTED_CLIENT).');
  const validation = load.ineligibleTiers?.find((tier) => tier.reasonCode === 'VALIDATION_REQUIRED' && tier.validationUrl);
  if (validation?.validationUrl) throw new ValidationRequiredError(validation.reasonMessage ?? 'Account validation required.', validation.validationUrl);
}

export async function resolveProject(input: ResolveProjectInput): Promise<ResolvedProject> {
  const { envProject } = input;
  const metadata = buildMetadata(envProject);

  const load = await callCodeAssist(input, LOAD_CODE_ASSIST_RESPONSE, 'POST', codeAssistUrl('loadCodeAssist'), {
    cloudaicompanionProject: envProject,
    metadata,
  });

  if (!load.currentTier) assertEligible(load);

  if (load.currentTier) {
    const projectId = load.cloudaicompanionProject || envProject;
    if (!projectId) throw missingProject(load);
    return {
      projectId,
      tierId: load.paidTier?.id ?? load.currentTier.id ?? STANDARD_TIER,
      tierName: load.paidTier?.name ?? load.currentTier.name ?? '',
    };
  }

  return onboardUser(input, load, metadata);
}

const defaultSleep = (ms: number): Promise<void> =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });

async function pollOperation(input: ResolveProjectInput, initial: Operation): Promise<Operation> {
  const sleep = input.sleep ?? defaultSleep;
  let operation = initial;
  for (let polls = 0; !operation.done && operation.name; polls++) {
    if (polls === MAX_POLLS) throw new CodeAssistError('Google Code Assist onboarding did not finish in time; run /login again');
    await sleep(POLL_INTERVAL_MS);
    operation = await callCodeAssist(input, OPERATION, 'GET', `${CODE_ASSIST_BASE_URL}/${operation.name}`);
  }
  return operation;
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

function missingProject(load: LoadCodeAssistResponse): CodeAssistError {
  const reasons = (load.ineligibleTiers ?? []).map((tier) => tier.reasonMessage).filter((message): message is string => Boolean(message));
  if (reasons.length > 0) return new IneligibleTierError(reasons.join(', '));
  return new ProjectRequiredError('This account requires setting the GOOGLE_CLOUD_PROJECT or GOOGLE_CLOUD_PROJECT_ID environment variable, then running /login again');
}

async function callCodeAssist<S extends z.ZodType>(input: Pick<ResolveProjectInput, 'accessToken' | 'signal' | 'fetchImpl'>, schema: S, method: 'GET' | 'POST', url: string, body?: object): Promise<z.output<S>> {
  const response = await input.fetchImpl(url, {
    method,
    headers: { Authorization: `Bearer ${input.accessToken}`, 'Content-Type': 'application/json', 'User-Agent': ANTIGRAVITY_USER_AGENT },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: input.signal,
  });
  const text = await response.text();
  if (!response.ok) throw new CodeAssistError(googleErrorMessage(text) ?? `Google Code Assist request failed (HTTP ${response.status})`);
  try {
    return schema.parse(JSON.parse(text));
  } catch {
    throw new CodeAssistError('Google Code Assist returned a response that is not JSON');
  }
}

export function googleErrorMessage(text: string): string | undefined {
  try {
    return GOOGLE_ERROR_BODY.safeParse(JSON.parse(text)).data?.error.message;
  } catch {
    return undefined;
  }
}
