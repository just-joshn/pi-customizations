export type CommandHook = Readonly<{ command: string; timeoutMs?: number }>;
export type HookGroup = Readonly<{ matcher?: string; hooks: readonly CommandHook[] }>;
export type HookEventName = 'PreToolUse' | 'PostToolUse' | 'PermissionRequest' | 'SubagentStart' | 'SubagentStop';
export type HookTable = Readonly<Partial<Record<HookEventName, readonly HookGroup[]>>>;
export type ParsedHooks = Readonly<{ hooks?: HookTable; unloadable?: string; notes: readonly string[] }>;

const guardEvents = new Set<string>(['PreToolUse', 'PermissionRequest']);
const supportedEvents = new Set<string>(['PreToolUse', 'PostToolUse', 'PermissionRequest', 'SubagentStart', 'SubagentStop']);
const recognizedEvents = new Set([...supportedEvents, 'PostToolUseFailure', 'PermissionDenied', 'Notification', 'UserPromptSubmit', 'SessionStart', 'SessionEnd', 'Stop', 'StopFailure', 'PreCompact', 'PostCompact']);

const guidance = 'declare guard hooks under "hooks:" with command handlers';

function commandHook(value: unknown): CommandHook | string {
  if (typeof value !== 'object' || value === null) return 'a hook handler must be an object';
  const { type, command, timeout } = value as Record<string, unknown>;
  if (type !== 'command') return `hook type '${String(type)}' is not supported`;
  if (typeof command !== 'string' || !command.trim()) return "a command hook needs a non-empty 'command'";
  if (timeout !== undefined && !(typeof timeout === 'number' && timeout > 0)) return "'timeout' must be a positive number of seconds";
  return { command, ...(typeof timeout === 'number' ? { timeoutMs: timeout * 1000 } : {}) };
}

function parseGroup(value: unknown): HookGroup | string {
  if (typeof value !== 'object' || value === null) return 'a hook group must be an object';
  const { matcher, hooks } = value as Record<string, unknown>;
  if (matcher !== undefined && typeof matcher !== 'string') return "'matcher' must be a string";
  if (!Array.isArray(hooks)) return "a hook group needs a 'hooks' list";
  const parsed = hooks.map(commandHook);
  const failure = parsed.find((hook): hook is string => typeof hook === 'string');
  if (failure) return failure;
  return { ...(matcher ? { matcher } : {}), hooks: parsed as CommandHook[] };
}

function parseEvent(event: string, value: unknown): readonly HookGroup[] | string {
  if (!Array.isArray(value)) return `${event} must be a list of hook groups`;
  const groups = value.map(parseGroup);
  const failure = groups.find((group): group is string => typeof group === 'string');
  return failure ?? (groups as HookGroup[]);
}

function normalizedEvent(event: string, notes: string[]): string {
  if (event !== 'Stop') return event;
  notes.push('Converted Stop hook to SubagentStop since it fires when the subagent finishes');
  return 'SubagentStop';
}

type Added = Readonly<{ table: HookTable; failure?: string }>;

function addEvent(table: HookTable, declared: string, value: unknown, notes: string[]): Added {
  const event = normalizedEvent(declared, notes);
  if (!recognizedEvents.has(event)) {
    notes.push(`Ignoring unknown hook event '${declared}'`);
    return { table };
  }
  const parsed = parseEvent(declared, value);
  if (typeof parsed === 'string') {
    if (guardEvents.has(event)) return { table, failure: parsed };
    notes.push(`Ignoring ${declared} hooks: ${parsed}`);
    return { table };
  }
  if (!supportedEvents.has(event)) {
    notes.push(`Ignoring ${declared} hooks: the event does not fire for subagents in Pi`);
    return { table };
  }
  const name = event as HookEventName;
  return { table: { ...table, [name]: [...(table[name] ?? []), ...parsed] } };
}

export function parseAgentHooks(frontmatter: Record<string, unknown>, agentType: string): ParsedHooks {
  const notes: string[] = [];
  for (const key of guardEvents) {
    if (Object.hasOwn(frontmatter, key)) return { notes, unloadable: `Agent '${agentType}': ${key} is declared at the frontmatter top level, outside "hooks" — ${guidance}` };
  }
  const raw = frontmatter.hooks;
  if (raw === undefined || raw === null) return { notes };
  if (typeof raw !== 'object' || Array.isArray(raw)) return { notes, unloadable: `Invalid hooks in agent '${agentType}': hooks must be a mapping of event names to hook groups` };
  let table: HookTable = {};
  for (const [declared, value] of Object.entries(raw)) {
    const added = addEvent(table, declared, value, notes);
    if (added.failure) return { notes, unloadable: `Invalid hooks in agent '${agentType}': ${added.failure}` };
    table = added.table;
  }
  return { notes, ...(Object.keys(table).length ? { hooks: table } : {}) };
}

const literalMatcher = /^[A-Za-z0-9_|]+$/;

export function matchesHook(matcher: string | undefined, subject: string): boolean {
  if (!matcher || matcher === '*') return true;
  if (literalMatcher.test(matcher)) return matcher.split('|').includes(subject);
  try {
    return new RegExp(matcher).test(subject);
  } catch {
    return matcher === subject;
  }
}
