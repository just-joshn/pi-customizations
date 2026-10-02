import { open, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { type ExtensionContext, isBashToolResult, type ToolResultEvent, type ToolResultEventResult } from '@earendil-works/pi-coding-agent';
import { PROVIDER_ID } from './index.ts';

// Provider CLI keeps shell output inline up to 30,000 characters. Above that it saves the output to a
// file and sends a 2,000 character preview. Measured on Provider CLI 2.1.287: 30,000 characters stayed
// inline and 40,000 were replaced by a preview.
const INLINE_LIMIT_CHARS = 30_000;
const PREVIEW_CHARS = 2_000;
const UTF8_MAX_BYTES_PER_CHAR = 4;

export type ToolResultHandler = (event: ToolResultEvent, ctx: Pick<ExtensionContext, 'model'>) => Promise<ToolResultEventResult | undefined>;

export interface ToolResultRegistrar {
  on(event: 'tool_result', handler: ToolResultHandler): void;
}

interface SavedOutput {
  readonly path: string;
  readonly bytes: number;
  readonly preview: string;
}

async function previewOfFile(path: string): Promise<SavedOutput> {
  const file = await open(path, 'r');
  try {
    const buffer = Buffer.alloc(PREVIEW_CHARS * UTF8_MAX_BYTES_PER_CHAR);
    const [{ bytesRead }, { size }] = await Promise.all([file.read(buffer, 0, buffer.length, 0), file.stat()]);
    return { path, bytes: size, preview: buffer.toString('utf8', 0, bytesRead).slice(0, PREVIEW_CHARS) };
  } finally {
    await file.close();
  }
}

async function saveOutput(toolCallId: string, text: string): Promise<SavedOutput> {
  const path = join(tmpdir(), `pi-bash-output-${toolCallId.replace(/[^\w-]/g, '_')}.txt`);
  await writeFile(path, text, { mode: 0o600 });
  return { path, bytes: Buffer.byteLength(text), preview: text.slice(0, PREVIEW_CHARS) };
}

function describe({ path, bytes, preview }: SavedOutput): string {
  return [`Output too large (${Math.round(bytes / 1024)}KB). Full output: ${path}`, 'Read it in parts or search it instead of loading it whole.', `Preview (first ${PREVIEW_CHARS} characters):`, preview].join('\n');
}

const capLargeBashOutput: ToolResultHandler = async (event, ctx) => {
  if (ctx.model?.provider !== PROVIDER_ID || !isBashToolResult(event)) return undefined;
  const text = event.content.flatMap((block) => (block.type === 'text' ? [block.text] : [])).join('');
  if (text.length <= INLINE_LIMIT_CHARS) return undefined;
  try {
    const saved = event.details?.fullOutputPath ? await previewOfFile(event.details.fullOutputPath) : await saveOutput(event.toolCallId, text);
    return { content: [{ type: 'text', text: describe(saved) }, ...event.content.filter((block) => block.type === 'image')] };
  } catch {
    return undefined;
  }
};

export default function (pi: ToolResultRegistrar) {
  pi.on('tool_result', capLargeBashOutput);
}
