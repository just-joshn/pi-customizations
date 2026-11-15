import type { FetchFunction } from '@earendil-works/pi-ai';
import { CODE_ASSIST_BASE_URL, USER_AGENT } from './constants.ts';

export class CodeAssistError extends Error {}

export class IneligibleTierError extends CodeAssistError {}

export class ValidationRequiredError extends CodeAssistError {
  readonly validationUrl: string;
  constructor(reasonMessage: string, validationUrl: string) {
    super(`${reasonMessage} Validate at: ${validationUrl}`);
    this.validationUrl = validationUrl;
  }
}

export class ProjectRequiredError extends CodeAssistError {}

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

interface Tier {
  id?: string;
  name?: string;
  isDefault?: boolean;
}

interface IneligibleTier {
  reasonCode?: string;
  reasonMessage?: string;
  validationUrl?: string;
}

interface LoadCodeAssistResponse {
  currentTier?: Tier | null;
  allowedTiers?: Tier[] | null;
  ineligibleTiers?: IneligibleTier[] | null;
  cloudaicompanionProject?: string | null;
  paidTier?: Tier | null;
}

interface Operation {
  name?: string;
  done?: boolean;
  response?: { cloudaicompanionProject?: { id?: string } };
  error?: { message?: string };
}

const METADATA = { ideType: 'IDE_UNSPECIFIED', platform: 'PLATFORM_UNSPECIFIED', pluginType: 'GEMINI' } as const;
const FREE_TIER = 'free-tier';
const LEGACY_TIER = 'legacy-tier';
const STANDARD_TIER = 'standard-tier';
const POLL_INTERVAL_MS = 5000;
const MAX_POLLS = 60;

export function readProjectOverride(env: NodeJS.ProcessEnv): string | undefined {
  const value = (env['GOOGLE_CLOUD_PROJECT'] || env['GOOGLE_CLOUD_PROJECT_ID'] || '').trim();
  if (!value) return undefined;
  if (/^\d+$/.test(value)) throw new CodeAssistError('GOOGLE_CLOUD_PROJECT must be the project ID string, not its number');
  return value;
}

export function codeAssistUrl(method: string): string {
  return `${CODE_ASSIST_BASE_URL}:${method}`;
}

export async function resolveProject(input: ResolveProjectInput): Promise<ResolvedProject> {
  const { envProject } = input;
  const metadata = { ...METADATA, ...(envProject ? { duetProject: envProject } : {}) };

  const load = await callCodeAssist<LoadCodeAssistResponse>(input, 'POST', codeAssistUrl('loadCodeAssist'), {
    cloudaicompanionProject: envProject,
    metadata,
  });

  if (!load.currentTier) {
    const validation = load.ineligibleTiers?.find((tier) => tier.reasonCode === 'VALIDATION_REQUIRED' && tier.validationUrl);
    if (validation?.validationUrl) throw new ValidationRequiredError(validation.reasonMessage ?? 'Account validation required.', validation.validationUrl);
  }

  if (load.currentTier) {
    const projectId = load.cloudaicompanionProject || envProject;
    if (!projectId) throw missingProject(load);
    return {
      projectId,
      tierId: load.paidTier?.id ?? load.currentTier.id ?? STANDARD_TIER,
      tierName: load.paidTier?.name ?? load.currentTier.name ?? '',
    };
  }

  const tier = load.allowedTiers?.find((candidate) => candidate.isDefault) ?? { id: LEGACY_TIER, name: '' };
  const tierId = tier.id ?? STANDARD_TIER;
  // The free tier uses a managed project. Sending one makes Google answer Precondition Failed.
  const onboard = tierId === FREE_TIER ? { tierId, metadata: METADATA } : { tierId, cloudaicompanionProject: envProject, metadata };
  let operation = await callCodeAssist<Operation>(input, 'POST', codeAssistUrl('onboardUser'), onboard);

  const sleep = input.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  for (let polls = 0; !operation.done && operation.name; polls++) {
    if (polls === MAX_POLLS) throw new CodeAssistError('Google Code Assist onboarding did not finish in time; run /login again');
    await sleep(POLL_INTERVAL_MS);
    operation = await callCodeAssist<Operation>(input, 'GET', `${CODE_ASSIST_BASE_URL}/${operation.name}`);
  }
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

async function callCodeAssist<T>(input: ResolveProjectInput, method: 'GET' | 'POST', url: string, body?: object): Promise<T> {
  const response = await input.fetchImpl(url, {
    method,
    headers: { Authorization: `Bearer ${input.accessToken}`, 'Content-Type': 'application/json', 'User-Agent': USER_AGENT },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: input.signal,
  });
  const text = await response.text();
  if (!response.ok) throw new CodeAssistError(googleErrorMessage(text) ?? `Google Code Assist request failed (HTTP ${response.status})`);
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new CodeAssistError('Google Code Assist returned a response that is not JSON');
  }
}

export function googleErrorMessage(text: string): string | undefined {
  try {
    const parsed: unknown = JSON.parse(text);
    if (typeof parsed === 'object' && parsed !== null && 'error' in parsed) {
      const { error } = parsed;
      if (typeof error === 'object' && error !== null && 'message' in error && typeof error.message === 'string' && error.message) return error.message;
    }
  } catch {
    return undefined;
  }
  return undefined;
}
