import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { expect, test } from 'vitest';

const root = fileURLToPath(new URL('../', import.meta.url));
const read = (path: string) => readFile(join(root, 'skills', path), 'utf8');
const triage = () => read('poteto-mode/references/bugbot-triage.md');

async function generatedSkillMarkdown(): Promise<string[]> {
  const names = await readdir(join(root, 'skills'), { recursive: true });
  return names.filter((name) => name.endsWith('.md') && !name.includes('node_modules') && !name.startsWith('setup-pstack/') && !name.startsWith('make-bot-ui/')).toSorted();
}

function prose(text: string): string {
  return text.replace(/```[\s\S]*?```/g, '').replace(/`[^`\n]*`/g, '');
}

test('generated skill prose has no long dash outside the setup-pstack labels', async () => {
  const offenders: string[] = [];
  const scanned = await generatedSkillMarkdown();
  for (const name of scanned) if (prose(await read(name)).includes('—')) offenders.push(name);
  expect(scanned).toContain('poteto-mode/SKILL.md');
  expect(scanned).not.toContain('setup-pstack/SKILL.md');
  expect(offenders).toEqual([]);
});

test('the setup-pstack budget labels keep their exact long-dash form', async () => {
  const setup = await read('setup-pstack/SKILL.md');
  for (const label of ['unlimited — keep max', 'large — xhigh reasoning', 'medium — high reasoning', 'small — medium reasoning']) expect(setup).toContain(label);
});

test('the bugbot triage reference has no semicolons or long dashes in its prose', async () => {
  const text = prose(await triage());
  expect(text.includes(';')).toBe(false);
  expect(text.includes('—')).toBe(false);
  expect(await triage()).toContain('### Contract-test drift claims are cheaply verifiable, so run the test first');
});

test('the bugbot triage reference says how an ask resolves under a full-autonomy grant', async () => {
  expect(await triage()).toContain(
    'Under a full-autonomy grant, decide an `ask` finding outside security, privacy, auth, billing, data, and migrations, and log the decision with its reason in the decision trail. Park an `ask` finding inside those categories as an operator gate and keep working the rest.',
  );
});

test('babysit runs a prose-pinning contract test before the third-pass dismissal lean', async () => {
  expect(await read('poteto-mode/playbooks/babysit.md')).toContain(
    'Run any prose-pinning contract test first per `references/bugbot-triage.md`, because a drift claim against such a test is cheap to verify and the lean toward dismissal does not apply to it.',
  );
});

test('tdd and principle headings use sentence case', async () => {
  const names = (await readdir(join(root, 'skills'), { withFileTypes: true })).filter((entry) => entry.isDirectory() && (entry.name === 'tdd' || entry.name.startsWith('principle-'))).map((entry) => entry.name);
  const offenders: string[] = [];
  for (const name of names) {
    for (const heading of (await read(`${name}/SKILL.md`)).match(/^#{1,6} .+$/gm) ?? []) {
      const words = heading.replace(/^#+ /, '').split(' ').slice(1);
      if (words.some((word) => /^[A-Z][a-z]/.test(word) && word !== 'I')) offenders.push(`${name} ${heading}`);
    }
  }
  expect(offenders).toEqual([]);
  expect(await read('tdd/SKILL.md')).toContain('## If a failing test is impractical');
  expect(await read('principle-make-operations-idempotent/SKILL.md')).toContain('# Make operations idempotent');
});

test('typescript patterns indent code with tabs, use one quote style, and mark the no-schema cast fallback', async () => {
  const patterns = await read('typescript-best-practices/references/patterns.md');
  const spaced = patterns.split('\n').filter((line) => /^ +\S/.test(line) && !/^ \*/.test(line));
  expect(spaced).toEqual([]);
  expect(patterns).toContain('Match the `readonly __brand: "X"` shape.');
  expect(patterns).toContain('// Do, when the repository has no runtime schema library. Earn the cast at the boundary. With a schema library, parse through the schema helper in the section above instead.');
});

test('no-comments cites the encoding principle and records a declined constraint in the trail', async () => {
  const skill = await read('no-comments/SKILL.md');
  expect(skill).toContain('per the **principle-encode-lessons-in-structure** skill');
  expect(skill).toContain('record the declined constraint as a row in the **show-me-your-work** `decisions.tsv` trail');
});

test('no-comments spawns Comment Sicko with the readonly flag and feeds it the resolved scope', async () => {
  expect(await read('no-comments/SKILL.md')).toContain(
    '1. Spawn `Task` with `subagent_type: "Comment Sicko"` and `readonly: true`. Resolve the scope first and pass it as files or diff text, because a read-only persona cannot run the diff command itself.',
  );
});

test('automate-me counts its inline pass separately from the two skills it orchestrates', async () => {
  expect(await read('automate-me/SKILL.md')).toContain('This skill orchestrates two skills and an inline pass.');
});

test('prove-it-works states the delegation rule and experience-first links foundational thinking', async () => {
  expect(await read('principle-prove-it-works/SKILL.md')).toContain('**Delegation.** Trust artifacts, not self-reports. When a subagent reports that work is done, read its diff or its output yourself before relying on it.');
  expect(await read('principle-experience-first/SKILL.md')).toContain('[Foundational thinking](../principle-foundational-thinking/SKILL.md) governs the *sequence* of work.');
});

test('sequencing defines green as the declared phase-boundary check under outcome-oriented execution', async () => {
  expect(await read('principle-sequence-verifiable-units/SKILL.md')).toContain(
    'Green means the check the plan declares for the unit. Under the **outcome-oriented-execution** principle skill, green at a declared phase boundary is the phase-boundary check that plan names, and breakage the plan scoped as temporary between boundaries is not red.',
  );
});

test('the how skill drops the explorer wording from a simple explain prompt', async () => {
  expect(await read('how/SKILL.md')).toContain(
    'Drop the sentence that begins "Multiple explorer agents have traced", the paragraph that begins "The explorers each investigated", and the sentence "The explorers did the work, so you shouldn\'t need to re-explore from scratch." No explorer ran, so the explainer explores for itself.',
  );
});

test('the why skill allows a scoped-ask skip and one investigator per category of a multi-category MCP', async () => {
  const why = await read('why/SKILL.md');
  expect(why).toContain('Three valid reasons:');
  expect(why).toContain('**The caller narrowed the ask.** The invoking skill or user scoped the question so a category cannot bear on it. Name the scoping ask in the justification.');
  expect(why).toContain("An MCP that fits several categories gets one investigator per category, each with that category's playbook, so no investigator covers more than one category.");
});

test('architect forces one alternative re-run before arena may ship a converged consensus', async () => {
  expect(await read('architect/SKILL.md')).toContain(
    'When arena reports that the runners converged on one shape, run the runners once more with a forced alternative direction before arena ships the consensus. That forced re-run satisfies this rule, and the arena rule that ships a converged shape applies only after it.',
  );
});

test('interrogate infers and states intent without reading it from the code, and reports a rejected default instead of opening a PR', async () => {
  const skill = await read('interrogate/SKILL.md');
  expect(skill).not.toContain('- The code itself');
  expect(skill).toContain(
    'If the sources leave the intent unclear, state your inferred intent in the paragraph, mark it as inferred, and proceed. Ask the user only when none of these sources exists. Never derive intent from the code alone, because that can bake a visible bug into the accepted intent.',
  );
  expect(skill).not.toContain('separate PR');
  expect(skill).toContain('report the rejected default in the review summary and suggest running `/setup-pstack`, because the table default lives in the package');
});

test('arena names the laziness-protocol principle skill', async () => {
  expect(await read('arena/SKILL.md')).toContain('per the **laziness-protocol** principle skill');
});

test('reflect reads only the named transcript and files Backlog items after approval', async () => {
  const reflect = await read('reflect/SKILL.md');
  expect(reflect).not.toMatch(/<session-dir>\/\*\.jsonl/);
  expect(reflect).toContain('Use that exact path.');
  expect(reflect).toContain('Do not glob the Pi session storage directory.');
  expect(reflect).toContain(
    'File Backlog items to GitHub issues through `gh` after the same approval as the Accepted edits, because filing is an external write. When no tracker is configured, list the Backlog items in the summary unfiled.',
  );
});

test('teach names a fallback when the host has no image tool', async () => {
  expect(await read('teach/SKILL.md')).toContain(
    'reach for an image tool only when the host contract names one. Pi registers no image-generation tool, so otherwise draw it as an SVG or mermaid sketch with a few short labels and say that you substituted it for an image.',
  );
});

test('the trail reviewer, figure-it-out judge, and recall miners each read a named role line', async () => {
  expect(await read('show-me-your-work/SKILL.md')).toContain('with `model` from the `trail reviewer` line in the `pstack-models.mdc` rule');
  expect(await read('figure-it-out/SKILL.md')).toContain("Set the judge's `model` from the `figure-it-out judge` line in the `pstack-models.mdc` rule");
  expect(await read('recall/SKILL.md')).toContain('with `model` from the `recall miners` line in the `pstack-models.mdc` rule');
});

test('deslop ends with a receipt of files touched and edits per focus area, and autopilot owners report it', async () => {
  expect(await read('deslop/SKILL.md')).toContain('end it with a receipt of files touched and edits per focus area');
  for (const name of ['autopilot-full', 'autopilot-stack']) {
    expect(await read(`poteto-mode/playbooks/${name}.md`)).toContain("receipt of files touched and edits per focus area goes in the owner's report");
  }
});

test('both code-quality copies carry the same Core Prompt block and the interrogate copy names its source', async () => {
  const block = (text: string) => text.match(/## Core Prompt\n[\s\S]*?(?=\n## )/)?.[0].replace(/\n\nSource:[^\n]*/, '');
  const copy = await read('interrogate/references/code-quality-review.md');
  expect(block(copy)).toBeDefined();
  expect(block(copy)).toBe(block(await read('thermo-nuclear-code-quality-review/SKILL.md')));
  expect(copy).toContain('Source: the Core Prompt block below is a copy of the Core Prompt block in the team-kit `thermo-nuclear-code-quality-review` skill. Keep the two in sync.');
});

test('the helper manifest and lock pin bun-types and typescript to the versions the lock resolves, and no latest survives', async () => {
  const manifest = JSON.parse(await read('poteto-mode/scripts/package.json')) as { devDependencies: Record<string, string> };
  const lock = await read('poteto-mode/scripts/bun.lock');
  expect(lock).not.toContain('"latest"');
  expect(await read('poteto-mode/scripts/package.json')).not.toContain('"latest"');
  for (const name of ['bun-types', 'typescript']) {
    const resolved = lock.match(new RegExp(`^ {4}"${name}": \\["${name}@([^"]+)"`, 'm'))?.[1];
    expect({ name, pinned: manifest.devDependencies[name] }).toEqual({ name, pinned: resolved });
    expect(lock).toContain(`"${name}": "${resolved}",`);
  }
});
