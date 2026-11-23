import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

export const FAKE_MODEL_ID = 'fake-model';
export const FAKE_PROVIDER = 'fake';

export interface FakeModelDefinition {
  readonly id: string;
  readonly name: string;
  readonly provider: string;
  readonly baseUrl: string;
  readonly api: string;
  readonly reasoning: boolean;
  readonly input: readonly string[];
  readonly cost: { readonly input: number; readonly output: number; readonly cacheRead: number; readonly cacheWrite: number };
  readonly contextWindow: number;
  readonly maxTokens: number;
}

/** Model object for the SDK, pointed at the deterministic server. */
export function fakeModel(baseUrl: string): FakeModelDefinition {
  return {
    id: FAKE_MODEL_ID,
    name: 'Fake Model',
    provider: FAKE_PROVIDER,
    baseUrl,
    api: 'openai-completions',
    reasoning: false,
    input: ['text'],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 32_000,
    maxTokens: 4096,
  };
}

/** Write the `models.json` a CLI or SDK session reads for the fake provider. */
export async function writeFakeModelConfig(agentDir: string, baseUrl: string): Promise<string> {
  await mkdir(agentDir, { recursive: true });
  const file = path.join(agentDir, 'models.json');
  const config = {
    providers: {
      [FAKE_PROVIDER]: {
        baseUrl,
        api: 'openai-completions',
        apiKey: 'test-key',
        models: [{ id: FAKE_MODEL_ID, name: 'Fake Model', reasoning: false, input: ['text'], contextWindow: 32_000, maxTokens: 4096 }],
      },
    },
  };
  await writeFile(file, JSON.stringify(config, null, 2), 'utf-8');
  return file;
}
