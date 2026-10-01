// Prints each captured request and result in JSON form so two versions can be diffed.
// Run it on both versions and compare the output.
import { type AssistantMessage, type AssistantMessageEventStream, type Model, normalizeContext, type Provider } from '@earendil-works/pi-ai';
import extension from '../src/index.ts';
import { ask } from '../test/support/context.ts';
import { OAUTH_ACCESS_TOKEN } from '../test/support/credentials.ts';
import { captureProvider } from '../test/support/load-extension.ts';
import { type MessagesServer, startMessagesServer } from '../test/support/messages-server.ts';
import { type Scenario, scenarios } from './equivalence-scenarios.ts';

const IDENTITY_HEADERS = ['authorization', 'x-api-key', 'anthropic-version', 'anthropic-beta', 'user-agent', 'x-app', 'content-type', 'accept', 'anthropic-dangerous-direct-browser-access'];

function findModel(provider: Provider, id: string): Model<string> {
  const model = provider.getModels().find((item) => item.id === id);
  if (!model) throw new Error(`missing model ${id}`);
  return model;
}

function withoutTimestamp(message: AssistantMessage) {
  return Object.fromEntries(Object.entries(message).filter(([key]) => key !== 'timestamp'));
}

function shapeRequest(server: MessagesServer) {
  const last = server.requests.at(-1);
  if (!last) return undefined;
  const headers = Object.fromEntries(IDENTITY_HEADERS.map((name) => [name, last.headers[name]]));
  const stainless = Object.keys(last.headers)
    .filter((name) => name.startsWith('x-stainless-'))
    .sort();
  return { headers, stainless, body: last.body };
}

async function drain(stream: AssistantMessageEventStream) {
  const events: string[] = [];
  for await (const event of stream) events.push(event.type);
  return { events, message: await stream.result() };
}

async function runScenario(provider: Provider, scenario: Scenario) {
  const server = await startMessagesServer(scenario.reply);
  try {
    const responses: number[] = [];
    const stream = provider.streamSimple({ ...findModel(provider, scenario.modelId), baseUrl: server.baseUrl }, normalizeContext(scenario.context), {
      apiKey: OAUTH_ACCESS_TOKEN,
      onResponse: (response) => void responses.push(response.status),
      ...scenario.options,
    });
    const { events, message } = await drain(stream);
    return { name: scenario.name, requests: server.requests.length, responses, request: shapeRequest(server), events, message: withoutTimestamp(message) };
  } finally {
    await server.close();
  }
}

async function missingToken(provider: Provider) {
  const [model] = provider.getModels();
  if (!model) throw new Error('missing model');
  try {
    const events: unknown[] = [];
    for await (const event of provider.streamSimple(model, normalizeContext(ask('hi')), {})) {
      events.push(event.type === 'error' ? { type: 'error', errorMessage: event.error.errorMessage } : event.type);
    }
    return { name: 'missing token', threw: false, events };
  } catch (error) {
    return { name: 'missing token', threw: true, message: error instanceof Error ? error.message : String(error) };
  }
}

const provider = captureProvider(extension);
const results = [...(await Promise.all(scenarios.map((scenario) => runScenario(provider, scenario)))), await missingToken(provider)];
const models = provider.getModels().map(({ id, api, provider: owner, compat }) => ({ id, api, provider: owner, compat }));
const summary = { provider: { id: provider.id, name: provider.name, oauth: provider.auth.oauth?.name, isSubscription: provider.auth.oauth?.isSubscription }, models, results };
process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
