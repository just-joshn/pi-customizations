import {
  type BackgroundCompletionPayload,
  DEFAULT_TASK_DESCRIPTION,
  FORTY,
  isActiveSubagentStatus,
  MAX_COLLAPSED_OUTPUT_CHARS,
  MAX_COLLAPSED_OUTPUT_LINES,
  MAX_DESCRIPTION_CHARS,
  MAX_TITLE_CHARS,
  MS_PER_SECOND,
  ONE,
  SECONDS_PER_DAY,
  SECONDS_PER_HOUR,
  SECONDS_PER_MINUTE,
  SHORT_ID_CHARS,
  type SubagentDefinition,
  type SubagentSessionRecord,
  THIRTY,
  TWENTY,
  TWENTY_FIVE,
  ZERO,
} from './types.ts';

const DECIMAL_PLACES = 1;
const MIN_DISPLAY_SECONDS = 1;
const PATH_SEP = '/';

export interface ToolActivityFormat {
  readonly verb: string;
  readonly detail: string;
  readonly stepLabel: string;
}

export function truncateEnd(text: string, maxChars: number): string {
  if (maxChars <= ZERO) {
    return '';
  }
  if (text.length <= maxChars) {
    return text;
  }
  return maxChars === ONE ? '…' : `${text.slice(ZERO, maxChars - ONE)}…`;
}

export function extractBasename(rawPath: string | undefined): string {
  if (!rawPath) {
    return '';
  }
  const normalized = rawPath.replace(/\\/g, PATH_SEP);
  const parts = normalized.split(PATH_SEP);
  return parts[parts.length - ONE] || rawPath;
}

export function formatDurationMs(durationMs: number | undefined): string | undefined {
  if (durationMs === undefined || !Number.isFinite(durationMs) || durationMs < ZERO) {
    return undefined;
  }
  if (durationMs < MS_PER_SECOND) {
    return `${Math.round(durationMs)}ms`;
  }
  const totalSeconds = durationMs / MS_PER_SECOND;
  if (totalSeconds < SECONDS_PER_MINUTE) {
    return `${totalSeconds.toFixed(DECIMAL_PLACES)}s`;
  }
  const wholeSeconds = Math.floor(totalSeconds);
  const minutes = Math.floor(wholeSeconds / SECONDS_PER_MINUTE);
  const remSeconds = wholeSeconds % SECONDS_PER_MINUTE;
  if (minutes < SECONDS_PER_MINUTE) {
    return remSeconds > ZERO ? `${minutes}m ${remSeconds}s` : `${minutes}m`;
  }
  const hours = Math.floor(minutes / SECONDS_PER_MINUTE);
  const remMinutes = minutes % SECONDS_PER_MINUTE;
  return remMinutes > ZERO ? `${hours}h ${remMinutes}m` : `${hours}h`;
}

export function formatElapsedCompact(elapsedMs: number): string {
  const totalSec = Math.max(ZERO, Math.floor(elapsedMs / MS_PER_SECOND));
  const days = Math.floor(totalSec / SECONDS_PER_DAY);
  const hours = Math.floor((totalSec % SECONDS_PER_DAY) / SECONDS_PER_HOUR);
  const minutes = Math.floor((totalSec % SECONDS_PER_HOUR) / SECONDS_PER_MINUTE);
  const seconds = totalSec % SECONDS_PER_MINUTE;
  const parts = [days > ZERO ? `${days}d` : '', hours > ZERO ? `${hours}h` : '', minutes > ZERO ? `${minutes}m` : '', seconds >= MIN_DISPLAY_SECONDS || (days === ZERO && hours === ZERO && minutes === ZERO) ? `${seconds}s` : ''].filter(
    (part) => part.length > ZERO,
  );
  return parts.join(' ');
}

function readStringArg(args: Readonly<Record<string, unknown>>, keys: readonly string[]): string {
  for (const key of keys) {
    const val = args[key];
    if (typeof val === 'string' && val.trim().length > ZERO) {
      return val.trim();
    }
  }
  return '';
}

function pathToolActivity(verb: string, fallback: string, args: Readonly<Record<string, unknown>>): ToolActivityFormat {
  const base = extractBasename(readStringArg(args, ['path', 'file_path']));
  const clipped = truncateEnd(base, THIRTY);
  return { verb, detail: base, stepLabel: clipped ? `${verb} ${clipped}` : fallback };
}

type ToolFormatter = (args: Readonly<Record<string, unknown>>) => ToolActivityFormat;

const TOOL_ACTIVITY_FORMATTERS: Readonly<Record<string, ToolFormatter>> = {
  read: (args) => pathToolActivity('Reading', 'Reading file', args),
  edit: (args) => pathToolActivity('Editing', 'Editing file', args),
  write: (args) => pathToolActivity('Writing', 'Writing file', args),
  delete: (args) => pathToolActivity('Deleting', 'Deleting file', args),
  ls: (args) => pathToolActivity('Listing', 'Listing directory', args),
  grep: (args) => {
    const pattern = readStringArg(args, ['pattern']);
    const clipped = pattern ? truncateEnd(pattern, TWENTY) : '';
    return { verb: 'Grepping', detail: clipped ? `"${clipped}"` : '', stepLabel: clipped ? `Searching "${clipped}"` : 'Searching' };
  },
  find: (args) => {
    const pattern = readStringArg(args, ['pattern', 'globPattern']);
    return { verb: 'Globbing', detail: pattern ? `"${truncateEnd(pattern, THIRTY)}"` : '', stepLabel: pattern ? `Finding ${truncateEnd(pattern, TWENTY_FIVE)}` : 'Finding files' };
  },
  glob: (args) => {
    const pattern = readStringArg(args, ['pattern', 'globPattern']);
    return { verb: 'Globbing', detail: pattern ? `"${truncateEnd(pattern, THIRTY)}"` : '', stepLabel: pattern ? `Finding ${truncateEnd(pattern, TWENTY_FIVE)}` : 'Finding files' };
  },
  bash: (args) => {
    const cmd = readStringArg(args, ['command']);
    return { verb: 'Running', detail: cmd ? truncateEnd(cmd, FORTY) : '', stepLabel: cmd ? `Running: ${truncateEnd(cmd, THIRTY)}` : 'Running command' };
  },
  shell: (args) => {
    const cmd = readStringArg(args, ['command']);
    return { verb: 'Running', detail: cmd ? truncateEnd(cmd, FORTY) : '', stepLabel: cmd ? `Running: ${truncateEnd(cmd, THIRTY)}` : 'Running command' };
  },
  task: (args) => {
    const desc = readStringArg(args, ['description']);
    return { verb: 'Running subagent', detail: desc ? truncateEnd(desc, THIRTY) : 'subagent', stepLabel: 'Running subagent' };
  },
};

export function formatToolActivity(toolName: string, args: Readonly<Record<string, unknown>>): ToolActivityFormat {
  const formatter = TOOL_ACTIVITY_FORMATTERS[toolName.toLowerCase()];
  return formatter ? formatter(args) : { verb: 'Calling', detail: toolName, stepLabel: 'Working…' };
}

export function truncateByLines(text: string, maxLines: number): { readonly text: string; readonly wasTruncated: boolean } {
  const lines = text.split('\n');
  if (lines.length <= maxLines) {
    return { text, wasTruncated: false };
  }
  return { text: `${lines.slice(ZERO, maxLines).join('\n')}…`, wasTruncated: true };
}

export function truncateOutputPreview(text: string): { readonly text: string; readonly wasTruncated: boolean } {
  const lines = text.split('\n');
  const lineClipped = lines.length > MAX_COLLAPSED_OUTPUT_LINES ? lines.slice(ZERO, MAX_COLLAPSED_OUTPUT_LINES).join('\n') : text;
  const linesTruncated = lines.length > MAX_COLLAPSED_OUTPUT_LINES;
  const charTruncated = lineClipped.length > MAX_COLLAPSED_OUTPUT_CHARS;
  const finalText = charTruncated ? lineClipped.slice(ZERO, MAX_COLLAPSED_OUTPUT_CHARS) : lineClipped;
  return { text: finalText.trimEnd(), wasTruncated: linesTruncated || charTruncated };
}

export function formatSessionTitle(description: string | undefined, prompt: string | undefined, agentId: string): string {
  const primary = (description ?? '').trim() || (prompt ?? '').trim();
  if (primary.length > ZERO) {
    const firstLine = primary.split('\n')[ZERO] ?? primary;
    return firstLine.slice(ZERO, MAX_TITLE_CHARS);
  }
  return `Subagent ${agentId.slice(ZERO, SHORT_ID_CHARS)}`;
}

export function formatShortDescription(description: string | undefined): string {
  const trimmed = (description ?? '').trim();
  return trimmed.length > ZERO ? truncateEnd(trimmed, MAX_DESCRIPTION_CHARS) : DEFAULT_TASK_DESCRIPTION;
}

export function formatRunningAgentsSummaryHeader(sessions: readonly SubagentSessionRecord[]): string {
  const activeCount = sessions.filter((s) => isActiveSubagentStatus(s.status)).length;
  const doneCount = sessions.filter((s) => s.status === 'success').length;
  const abortedCount = sessions.filter((s) => s.status === 'error' || s.status === 'cancelled').length;
  const cancelledCount = sessions.filter((s) => s.status === 'cancelled').length;
  const failedCount = abortedCount - cancelledCount;
  const abortParts = [cancelledCount > ZERO ? `${cancelledCount} cancelled` : '', failedCount > ZERO ? `${failedCount} failed` : ''].filter((p) => p.length > ZERO).join(', ');

  if (activeCount === ZERO && sessions.length > ZERO) {
    if (abortedCount === ZERO) {
      return `${doneCount} ${doneCount === ONE ? 'agent' : 'agents'} completed`;
    }
    return doneCount === ZERO ? abortParts : `${doneCount} completed, ${abortParts}`;
  }
  const base = `Running ${activeCount} ${activeCount === ONE ? 'agent' : 'agents'}…`;
  const suffixParts = [doneCount > ZERO ? `${doneCount} done` : '', abortedCount > ZERO ? abortParts : ''].filter((p) => p.length > ZERO);
  return suffixParts.length > ZERO ? `${base} (${suffixParts.join(', ')})` : base;
}

export function formatBackgroundCompletionHeader(completions: readonly BackgroundCompletionPayload[]): { readonly label: string; readonly title?: string; readonly isGrouped: boolean } {
  if (completions.length > ONE) {
    return { label: 'Finished', title: `${completions.length} background tasks`, isGrouped: true };
  }
  const first = completions[ZERO];
  const title = first?.title.trim();
  return title && title.length > ZERO ? { label: 'Finished', title, isGrouped: false } : { label: 'Finished', isGrouped: false };
}

export function buildSubagentsContextPrompt(definitions: readonly SubagentDefinition[]): string {
  const lines = definitions.map((def) => {
    const flags = [def.permissionMode === 'readonly' ? 'readonly' : undefined, def.isBackground ? 'background-by-default' : undefined, def.model !== 'inherit' ? `model=${def.model}` : undefined].filter(
      (item): item is string => item !== undefined,
    );
    const suffix = flags.length > ZERO ? ` (${flags.join(', ')})` : '';
    const desc = def.description.trim() || `Custom subagent (${def.source})`;
    return `- \`${def.name}\`${suffix}: ${desc}`;
  });
  return [
    '[SUBAGENTS AVAILABLE]',
    'You can delegate isolated work to subagents using the `task` tool and wait on background subagents using `await_subagent`.',
    'Available `subagent_type` values:',
    ...lines,
    'Use `run_in_background: true` to launch independent work without blocking, and `resume: "<agent_id>"` to continue an existing subagent session.',
  ].join('\n');
}
