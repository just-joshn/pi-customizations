import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { compactRenderers } from './rows/row.ts';
import { isCompactTool, TOOL_SPECS } from './rows/specs.ts';

export default function toolRows(pi: ExtensionAPI): void {
  pi.registerToolRenderer((toolName, next) => {
    if (!isCompactTool(toolName)) return next();
    const native = next();
    return native ? compactRenderers(TOOL_SPECS[toolName], native) : native;
  });
}
