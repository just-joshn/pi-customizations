import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { compactRenderers } from './rows/row.ts';
import { genericSpec, isCompactTool, TOOL_SPECS } from './rows/specs.ts';

export default function toolRows(pi: ExtensionAPI): void {
  pi.registerToolRenderer((toolName, next) => {
    const native = next();
    if (isCompactTool(toolName)) return native ? compactRenderers(TOOL_SPECS[toolName], native) : native;
    return native?.renderCall || native?.renderResult ? native : compactRenderers(genericSpec(toolName), {});
  });
}
