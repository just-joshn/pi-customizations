import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';

const figureItOutSkillMarker = /<skill\s+name="figure-it-out"(?:\s|>)/;
const blockedUntilPlaybook = new Set(['bash', 'powershell', 'edit', 'write']);

export const figureItOutPlaybookGateMessage =
  'The figure-it-out skill is active. Write an on-disk playbook (PLAYBOOK.md, decisions.tsv, DECISIONS.md, or .audit trail) with phases and a falsifiable done predicate before any product edit, write, or bash mutation.';

export const figureItOutPlaybookUsageBlock = `<pstack_fio_playbook>
The figure-it-out skill is active for this turn. The deliverable before any product code is an auditable playbook on disk.
1. Frame the falsifiable done predicate and phase list.
2. Write it with the write (or edit) tool to PLAYBOOK.md, decisions.tsv, DECISIONS.md, or under .audit/.
3. Only after that file exists may you edit product code or run bash that mutates the tree.
Do not batch product writes and the playbook into one bash script. Readonly read/grep/find/ls are allowed before the playbook lands.
</pstack_fio_playbook>`;

const playbookReminder =
  'The figure-it-out skill requires an on-disk playbook (phases + falsifiable done predicate) before product work. Write PLAYBOOK.md, decisions.tsv, DECISIONS.md, or an .audit trail with the write tool now. Do not edit src/ or run mutating bash until that file exists.';

export function figureItOutSkillPrompt(prompt: string): boolean {
  return figureItOutSkillMarker.test(prompt);
}

export function isPlaybookArtifactPath(filePath: string): boolean {
  const normalized = filePath.replaceAll('\\', '/');
  const lower = normalized.toLowerCase();
  const base = (normalized.split('/').pop() ?? '').toLowerCase();
  if (base === 'decisions.tsv' || base === 'decisions.md') return true;
  if (lower.includes('/.audit/')) return true;
  if (/^playbook[^/]*\.md$/.test(base)) return true;
  if (/^workflow[^/]*\.md$/.test(base)) return true;
  if (/^phases?\.md$/.test(base)) return true;
  if (/done.?predicate/.test(base) && base.endsWith('.md')) return true;
  return false;
}

function toolPath(input: Record<string, unknown>): string | null {
  const path = input['path'] ?? input['file_path'] ?? input['filePath'];
  return typeof path === 'string' && path.length > 0 ? path : null;
}

export function playbookWriteStarted(toolName: string, input: Record<string, unknown>): boolean {
  if (toolName !== 'write' && toolName !== 'edit') return false;
  const path = toolPath(input);
  return path !== null && isPlaybookArtifactPath(path);
}

export function registerFigureItOutPlaybookGate(pi: ExtensionAPI): void {
  let armed = false;
  let playbookLanded = false;
  let nudged = false;

  pi.on('before_agent_start', (event) => {
    armed = figureItOutSkillPrompt(event.prompt);
    playbookLanded = false;
    nudged = false;
    if (!armed) return;
    event.systemPromptOptions.sections['pstack_fio_playbook'] = figureItOutPlaybookUsageBlock;
  });

  pi.on('tool_call', (event) => {
    if (!armed) return;
    if (playbookWriteStarted(event.toolName, event.input as Record<string, unknown>)) {
      playbookLanded = true;
      return;
    }
    if (playbookLanded || !blockedUntilPlaybook.has(event.toolName)) return;
    return { block: true, reason: figureItOutPlaybookGateMessage };
  });

  pi.on('agent_before_settle', (event) => {
    if (!armed || playbookLanded || nudged || event.outcome !== 'completed') return;
    nudged = true;
    return {
      entries: [{ type: 'custom_message', customType: 'pstack-fio-playbook', display: true, content: playbookReminder }],
      continue: true,
    };
  });

  pi.on('agent_end', () => {
    armed = false;
    playbookLanded = false;
    nudged = false;
  });
}
