import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';

const UPSTREAM_REVISION = '5866df557357d005b3c0c9d3da0d9e739b4bdde3';
const IDENTIFIER = /^[a-z0-9][a-z0-9-]{0,39}$/;
const PACKAGE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

export function playbookSteps(source) {
  const lines = source.split('\n');
  let fence;
  const starts = [];
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];
    const marker = /^\s*(`{3,}|~{3,})/.exec(line)?.[1];
    if (marker) {
      if (!fence) fence = marker;
      else if (marker[0] === fence[0] && marker.length >= fence.length) fence = undefined;
      continue;
    }
    if (!fence && /^\d+\. /.test(line)) starts.push(index);
  }
  return starts.map((start, index) => {
    let end = starts[index + 1];
    if (end === undefined) {
      end = start + 1;
      while (end < lines.length && (/^\s/.test(lines[end]) || lines[end] === '')) end++;
    }
    while (end > start && lines[end - 1] === '') end--;
    return lines.slice(start, end).join('\n');
  });
}

function git(cwd, ...args) {
  try {
    return execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return null;
  }
}

export function startRun({ playbook, title, runId = randomUUID(), playbooksDir = join(PACKAGE_ROOT, 'generated/skills/poteto-mode/playbooks'), cwd = process.cwd(), parentSessionFile = process.env.PI_SESSION_FILE ?? null }) {
  if (!IDENTIFIER.test(runId)) throw new Error('Invalid run id');
  if (!IDENTIFIER.test(playbook)) throw new Error('Invalid playbook id');
  if (typeof title !== 'string' || !title.trim() || /[\r\n]/.test(title)) throw new Error('Title must be a nonempty single line');
  const steps = playbookSteps(readFileSync(join(playbooksDir, `${playbook}.md`), 'utf8'));
  const project = git(cwd, 'rev-parse', '--show-toplevel') ?? resolve(cwd);
  const runDir = join(project, '.pi/pstack/runs', runId);
  const manifest = {
    schemaVersion: 1, runId, title, playbook, upstreamRevision: UPSTREAM_REVISION,
    createdAt: new Date().toISOString(), parentSessionFile, inputCommit: git(cwd, 'rev-parse', 'HEAD'),
  };
  mkdirSync(dirname(runDir), { recursive: true });
  mkdirSync(runDir);
  const temporary = join(runDir, 'run.json.tmp');
  writeFileSync(temporary, `${JSON.stringify(manifest, null, 2)}\n`, { flag: 'wx' });
  renameSync(temporary, join(runDir, 'run.json'));
  writeFileSync(join(runDir, 'TODO.md'), `# ${title}\n\nSource playbook: ${playbook}.md\nUpstream revision: ${UPSTREAM_REVISION}\n\n## Original playbook steps\n${steps.length === 0 ? `_${playbook}.md has no numbered steps. Its rules apply in full: read ${join(playbooksDir, `${playbook}.md`)}._` : steps.map((step) => `- [ ] ${step}`).join('\n')}\n\n## Task-specific work\n`, { flag: 'wx' });
  return runDir;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const { values } = parseArgs({ options: {
      playbook: { type: 'string' }, title: { type: 'string' }, 'run-id': { type: 'string' },
      'playbooks-dir': { type: 'string' }, 'parent-session-file': { type: 'string' },
    } });
    console.log(startRun({ playbook: values.playbook, title: values.title, runId: values['run-id'], playbooksDir: values['playbooks-dir'], parentSessionFile: values['parent-session-file'] }));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
