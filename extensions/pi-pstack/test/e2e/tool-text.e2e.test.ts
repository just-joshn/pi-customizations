// The tool text the model reads, through real Pi over RPC so tools that need a person (SwitchMode) are offered,
// against the text a live Cursor CLI session declared.
import { expect, onTestFinished, test } from 'vitest';
import { cursorToolDescription, cursorToolText } from '../cursor-reference.ts';
import { contentText, makeSandbox, type PiEvent, startRpc } from './harness.ts';

const TOOLS = ['TodoWrite', 'SwitchMode', 'GenerateImage', 'AwaitShell', 'AskQuestion'];

interface Schema {
  description?: string;
  properties?: Record<string, Schema>;
  items?: Schema;
  required?: string[];
}

/** A parameter's description by dotted path, stepping into array items: questions.options.id. */
function describedAt(schema: Schema, path: string): string | undefined {
  let node: Schema | undefined = schema;
  for (const name of path.split('.')) node = (node?.items ?? node)?.properties?.[name];
  return node?.description;
}

async function declared(names: readonly string[]) {
  const sandbox = makeSandbox({ extensions: [`${process.cwd()}/test/fixtures/scripted-model.ts`, `${process.cwd()}/test/fixtures/image-model.ts`] });
  onTestFinished(sandbox.dispose);
  const rpc = startRpc(sandbox, ['--no-session']);
  onTestFinished(() => rpc.close());
  const ask = async (message: string) => {
    const mark = rpc.events.length;
    rpc.send({ type: 'prompt', message });
    await rpc.waitFor((event: PiEvent) => event.type === 'agent_settled' && rpc.events.indexOf(event) >= mark);
    const reply = rpc.events
      .slice(mark)
      .filter((event) => event.type === 'message_end' && (event['message'] as { role: string }).role === 'assistant')
      .at(-1);
    if (reply === undefined) throw new Error(`no reply to ${message}`);
    return contentText((reply['message'] as { content: string }).content);
  };
  const result = new Map<string, { description: string; parameters: Schema }>();
  for (const name of names) result.set(name, { description: await ask(`describe\n@@tool-description ${name}`), parameters: JSON.parse(await ask(`schema\n@@tool-schema ${name}`)) });
  return result;
}

test('TodoWrite, SwitchMode, GenerateImage, AwaitShell, and AskQuestion declare Cursor text', async () => {
  const pi = await declared(TOOLS);
  for (const name of TOOLS) {
    const tool = pi.get(name);
    const cursor = cursorToolText.tools[name];
    expect.soft(tool?.description, name).toBe(cursorToolDescription(name));
    expect.soft(Object.fromEntries(Object.keys(cursor?.parameters ?? {}).map((parameter) => [parameter, tool === undefined ? undefined : describedAt(tool.parameters, parameter)])), name).toEqual(cursor?.parameters);
    expect.soft(tool?.parameters.required ?? [], name).toEqual(cursor?.required);
  }
});
