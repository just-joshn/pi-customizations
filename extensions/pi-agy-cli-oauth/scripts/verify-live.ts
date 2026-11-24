/**
 * Proves the extension against the real Antigravity CLI rather than a fake.
 *
 * `bun run scripts/verify-live.ts` from the package root.
 *
 * Two things are checked. First, the catalog the CLI actually reports. Second,
 * one real turn through `session/prompt`, driven by the production stream
 * implementation, with its Pi event sequence printed.
 *
 * A blocked Antigravity account answers a turn with an assistant notice instead
 * of model output. The stream must turn that into a non-retryable policy error,
 * so a blocked account still produces a green run.
 */
import { normalizeContext, type Model, type Tool } from '@earendil-works/pi-ai';
import { connectAcp } from '../src/acp/client.ts';
import { API_ID } from '../src/constants.ts';
import { discover } from '../src/discovery.ts';
import { launchSpec } from '../src/launch.ts';
import { catalogToModels, resolveSelection } from '../src/model-catalog.ts';
import { streamAgy } from '../src/stream.ts';

const PAD = 28;
const SAMPLE_CHARS = 200;
const PROMPT = 'Reply with exactly: hello';
const TOOL_PROMPT = 'List the files in the working directory. Use your run_command tool now.';
const BASH: Tool = {
  name: 'bash',
  description: 'Run a shell command',
  parameters: { type: 'object', properties: { command: { type: 'string' } }, required: ['command'] },
};

function say(line: string): void {
  process.stdout.write(`${line}\n`);
}

async function catalog(): Promise<readonly Model<typeof API_ID>[]> {
  const spec = launchSpec(undefined);
  say(`command: ${spec.command} ${spec.args.join(' ')}`);
  const client = await connectAcp({ ...spec, cwd: process.cwd(), onStderr: () => undefined });
  try {
    const discovery = await discover(client);
    say(`agent:   ${discovery.version}`);
    say(`plan:    ${discovery.tierName ?? 'unknown'}`);
    for (const entry of discovery.models) {
      const efforts = entry.efforts.length > 0 ? ` efforts=${entry.efforts.join(',')}` : '';
      say(`  ${entry.baseId.padEnd(PAD)} ${entry.name}${efforts}  variants=${entry.variants.join(',')}`);
    }
    const models = catalogToModels(discovery);
    say(`pi models: ${models.map((model) => model.id).join(', ')}`);
    const first = models[0]?.id ?? '';
    say(`selection for ${first} at high: ${JSON.stringify(resolveSelection(first, 'high'))}`);
    return models;
  } finally {
    client.close();
  }
}

async function turn(model: Model<typeof API_ID>): Promise<void> {
  say(`turn:    ${model.id} via ${PROMPT}`);
  const context = normalizeContext({ messages: [{ role: 'user', content: PROMPT, timestamp: Date.now() }] });
  const stream = streamAgy(model, context, { reasoning: 'high' });
  let kinds = '';
  for await (const event of stream) {
    kinds = kinds === '' ? event.type : `${kinds} ${event.type}`;
    if (event.type !== 'done' && event.type !== 'error') continue;
    const message = event.type === 'done' ? event.message : event.error;
    const text = message.content.flatMap((block) => (block.type === 'text' ? [block.text] : [])).join('');
    say(`events:  ${kinds}`);
    say(`stop:    ${message.stopReason}`);
    say(`usage:   in=${message.usage.input} out=${message.usage.output} thinking=${message.usage.reasoning ?? 0}`);
    if (message.errorMessage !== undefined) say(`error:   ${message.errorMessage}`);
    if (text !== '') say(`text:    ${JSON.stringify(text.slice(0, SAMPLE_CHARS))}`);
  }
}

/**
 * The tool path is the one that matters: the CLI must ask, be refused, and hand
 * the call to Pi instead of running it.
 */
async function toolTurn(model: Model<typeof API_ID>): Promise<void> {
  say(`tool:    ${model.id} via ${TOOL_PROMPT}`);
  const context = normalizeContext({ messages: [{ role: 'user', content: TOOL_PROMPT, timestamp: Date.now() }], tools: [BASH] });
  for await (const event of streamAgy(model, context, { reasoning: 'low' })) {
    if (event.type === 'toolcall_end') say(`bridged: ${JSON.stringify(event.toolCall)}`);
    if (event.type !== 'done' && event.type !== 'error') continue;
    const message = event.type === 'done' ? event.message : event.error;
    say(`tool stop: ${message.stopReason} usage in=${message.usage.input} out=${message.usage.output}`);
    if (message.errorMessage !== undefined) say(`tool error: ${message.errorMessage}`);
  }
}

const models = await catalog();
const first = models[0];
if (first === undefined) {
  say('no models reported by the CLI');
  process.exit(1);
}
await turn(first);
await toolTurn(first);
