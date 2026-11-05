#!/usr/bin/env node
// Usage: review-verdicts.mjs <adaptation-hunks.json> <out.tsv>
// Records this run's manual verdict for every hunk classify-adaptations.mjs could not explain by a Cursor token.
// Each rule names the files it covers and why the change is a host translation; an unmatched hunk fails the run.
import { readFileSync, writeFileSync } from 'node:fs';

const [input, out] = process.argv.slice(2);
const RULES = [
  [/^(pstack|cursor-team-kit)\/(README\.md|LICENSE)$/, 'package-doc', "pi-pstack's own README and license notice replace the plugin README and LICENSE; both upstream licenses ship under licenses/"],
  [
    /^pstack\/automations\/benny\//,
    'host-substitute',
    'Cursor Automations and its Slack trigger become pi-pstack subscriptions in a Pi session; readonly children do not isolate credentials in Pi, so the pack keeps analysis in the coordinator unless isolation is proven; a relayed webhook may carry message_ts',
  ],
  [
    /^pstack\/docs\/guide\//,
    'host-translation',
    'install, setup, and UI wording for Pi (package instead of plugin, rule applies from the next request, worktree instead of a cloud machine, Project notes instead of dragging chats, system player for video)',
  ],
  [/^pstack\/skills\/ketchup(-video)?\/SKILL\.md$/, 'host-ui', 'Pi chat renders no inline image or video, so screenshots are read with the read tool and video opens in the system player; /visualize becomes the visualize tool'],
  [/^pstack\/skills\/make-bot-ui\/SKILL\.md$/, 'host-substitute', 'Grok Bot routine creation through update_state becomes subscribe_webhook with a local credential file; a 200 means the routine accepted the event'],
  [/^pstack\/skills\/poteto-help\/SKILL\.md$/, 'host-translation', 'Pi advertises model-invocable bundled team-kit skills, the model rule applies from the next request, and Auto is not a Pi concept'],
  [/^pstack\/skills\/poteto-mode\/SKILL\.md$/, 'host-translation', 'icon and color move under metadata for the Agent Skills loader; Task resume and stop_agent name the Pi tools for messaging and stopping'],
  [
    /^pstack\/skills\/poteto-mode\/playbooks\/(autopilot-full|multi-phase-plan|orchestrate)\.md$/,
    'host-translation',
    'stop_agent, Task resume steers, Task fork, subscribe_github_pr, and Project folders name the Pi mechanisms for the same steps',
  ],
  [/^pstack\/skills\/poteto-mode\/scripts\/worktree-audit\.sh$/, 'host-translation', 'the transcript scan reads Pi session folders and subagent transcripts instead of agent-transcripts'],
  [/^pstack\/skills\/reflect\/SKILL\.md$/, 'host-translation', 'Pi session file layout instead of Cursor transcript layouts'],
  [/^pstack\/skills\/setup-pstack\/SKILL\.md$/, 'host-translation', 'Pi model specs and the Pi model rule path, read before every request'],
  [/^pstack\/skills\/statechart\/scripts\/test\/cli\.test\.ts$/, 'test-robustness', 'realpath for macOS temp links and an ENOENT guard for a draft tree that disappears mid-walk; no product change'],
  [/^pstack\/skills\/swarm\/SKILL\.md$/, 'host-substitute', 'environment cloud is a local worktree in Pi, so lanes need distinct ports and paths and no VM isolation is claimed'],
  [/^pstack\/skills\/typescript-best-practices\/SKILL\.md$/, 'metadata-move', 'paths moves under metadata; the skill also sets disable-model-invocation, so Cursor surfaces it only by name'],
];
const { hunks } = JSON.parse(readFileSync(input, 'utf8'));
const rows = [['file', 'hunk', 'verdict', 'reason'].join('\t')];
const unmatched = [];
for (const hunk of hunks.filter((candidate) => candidate.labels.includes('review'))) {
  const rule = RULES.find(([pattern]) => pattern.test(hunk.file));
  if (rule === undefined) unmatched.push(`${hunk.file} ${hunk.header}`);
  else rows.push([hunk.file, hunk.header, rule[1], rule[2]].join('\t'));
}
if (unmatched.length > 0) {
  console.error(`Unreviewed hunks:\n${unmatched.join('\n')}`);
  process.exit(1);
}
writeFileSync(out, `${rows.join('\n')}\n`);
console.log(`${rows.length - 1} review hunks have a recorded verdict`);
