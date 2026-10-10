import { splitlines } from '../support/pystr.ts';

export type Fence = readonly [open: string, close: string];

export const defaultFence: Fence = ['```', '```'];

export const allFences: readonly Fence[] = [defaultFence, ['````', '````'], ['<source>', '</source>'], ['<code>', '</code>'], ['<pre>', '</pre>'], ['<codeblock>', '</codeblock>'], ['<sourcecode>', '</sourcecode>']];

class IndexError extends Error {
  override name = 'IndexError';
}

export function chooseFence(contents: readonly string[] = [], readonlyContents: readonly (string | null)[] = [], fences: readonly Fence[] = allFences): { readonly fence: Fence; readonly warnings: readonly string[] } {
  const allContent = [...contents, ...readonlyContents.filter((content) => content !== null)].map((content) => `${content}\n`).join('');
  const lines = splitlines(allContent);
  for (const fence of fences) {
    if (lines.some((line) => line.startsWith(fence[0]) || line.startsWith(fence[1]))) continue;
    return { fence, warnings: [] };
  }
  const fence = fences[0];
  if (fence === undefined) throw new IndexError('list index out of range');
  return { fence, warnings: [`Unable to find a fencing strategy! Falling back to: ${fence[0]}...${fence[1]}`] };
}
