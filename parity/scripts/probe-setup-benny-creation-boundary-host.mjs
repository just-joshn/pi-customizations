#!/usr/bin/env node
// Probe whether setup-benny first-time creation can finish through the
// built-in /automate → Automations editor handoff inside the PTY harness.
// Usage: node parity/scripts/probe-setup-benny-creation-boundary-host.mjs
import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash } from 'node:crypto';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const execFileAsync = promisify(execFile);
const isMain = Boolean(process.argv[1]) && import.meta.url === pathToFileURL(process.argv[1]).href;
const root = new URL('../', import.meta.url).pathname;
const evidenceRoot = join(root, 'evidence', 'setup-benny', 'creation-boundary');
const cursorAgentBin = join(homedir(), '.local', 'bin', 'cursor-agent');
const cursorAgentVersionRoot = join(
  homedir(),
  '.local',
  'share',
  'cursor-agent',
  'versions',
  '2026.10.01-e373342',
);
const docsRetrieval = join(
  root,
  'research',
  'cursor-host',
  'services',
  'retrievals',
  'docs_cloud-agent_automations.md',
);
const setupBennySkill = join(
  root,
  'reference',
  'cursor-plugins',
  'pstack',
  'automations',
  'benny',
  'skills',
  'setup-benny',
  'SKILL.md',
);
const piAutomateMe = join(root, '..', 'extensions', 'pi-pstack', 'skills', 'automate-me', 'SKILL.md');
const piAutomateSkill = join(root, '..', 'extensions', 'pi-pstack', 'host', 'skills', 'automate', 'SKILL.md');
const piAutomationsEditor = join(root, '..', 'extensions', 'pi-pstack', 'src', 'automations-editor.ts');
const piAutomationsTools = join(root, '..', 'extensions', 'pi-pstack', 'src', 'automations.ts');
const piAutomationsEditorTest = join(root, '..', 'extensions', 'pi-pstack', 'test', 'automations-editor.test.ts');
const piSetupBennyAdapter = join(root, '..', 'extensions', 'pi-pstack', 'host', 'adapters', 'benny', 'SKILL.md');

async function detectPiAutomationsEditorChrome() {
  const [editorSrc, toolsSrc, testSrc, skillPresent] = await Promise.all([
    readText(piAutomationsEditor),
    readText(piAutomationsTools),
    readText(piAutomationsEditorTest),
    pathExists(piAutomateSkill),
  ]);
  if (!editorSrc || !toolsSrc || !testSrc || !skillPresent) {
    return { available: false, reasons: ['missing editor module, tools wire, editor tests, or host/skills/automate/SKILL.md'] };
  }
  const reasons = [];
  if (!/export const AUTOMATIONS_EDITOR_CHROME = 'pi-automations-editor-v1'/.test(editorSrc)) {
    reasons.push('automations-editor.ts missing AUTOMATIONS_EDITOR_CHROME export');
  }
  if (!/export function renderAutomationsEditor/.test(editorSrc) || !/export function reduceAutomationsEditor/.test(editorSrc)) {
    reasons.push('automations-editor.ts missing render/reduce exports');
  }
  if (!/State: \$\{state\.stateLabel\}/.test(editorSrc) && !/State: Inactive/.test(editorSrc)) {
    reasons.push('automations-editor.ts does not render Inactive state');
  }
  if (!/from '\.\/automations-editor\.ts'/.test(toolsSrc)) {
    reasons.push('automations.ts does not import automations-editor');
  }
  if (!/ui\.custom/.test(toolsSrc) || /ui\.editor\(/.test(toolsSrc)) {
    reasons.push('automations.ts must open chrome via ctx.ui.custom and must not use ctx.ui.editor stub');
  }
  if (!/AUTOMATIONS_EDITOR_CHROME/.test(toolsSrc)) {
    reasons.push('automations.ts does not stamp AUTOMATIONS_EDITOR_CHROME on OpenEditor results');
  }
  if (!/State: Inactive/.test(testSrc) || !/disposition: 'saved'/.test(testSrc) || !/disposition: 'cancelled'/.test(testSrc)) {
    reasons.push('automations-editor.test.ts must cover Inactive chrome plus save and cancel dispositions');
  }
  return { available: reasons.length === 0, reasons };
}

async function detectPiSetupBennyAdapterAutomatePath() {
  const adapterSrc = await readText(piSetupBennyAdapter);
  if (!adapterSrc) {
    return { available: false, reasons: ['missing host/adapters/benny/SKILL.md'] };
  }
  const reasons = [];
  if (!/host `\/automate` skill/.test(adapterSrc) && !/host `\/automate`/.test(adapterSrc)) {
    reasons.push('adapter does not name the host /automate skill');
  }
  if (!/AutomationPrepare/.test(adapterSrc)) {
    reasons.push('adapter does not route first-time creation through AutomationPrepare');
  }
  if (!/AutomationOpenEditor/.test(adapterSrc)) {
    reasons.push('adapter does not open Automations editor via AutomationOpenEditor');
  }
  if (!/Do not finish Slack Benny through webhook `Routine\*` tools/.test(adapterSrc)) {
    reasons.push('adapter must refuse webhook Routine* finish for Slack Benny');
  }
  if (/Call `Routine(?:Prepare|Enable)`/.test(adapterSrc)) {
    reasons.push('adapter still calls RoutinePrepare/RoutineEnable for Slack Benny');
  }
  return { available: reasons.length === 0, reasons };
}

async function detectPiThreadSafetyReceiptTool() {
  const toolsSrc = await readText(piAutomationsTools);
  const testSrc = await readText(join(root, '..', 'extensions', 'pi-pstack', 'test', 'automations.test.ts'));
  const clientSrc = await readText(join(root, '..', 'extensions', 'pi-pstack', 'scripts', 'automation-client.mjs'));
  if (!toolsSrc || !testSrc || !clientSrc) {
    return { available: false, reasons: ['missing automations.ts, automations.test.ts, or automation-client.mjs'] };
  }
  const reasons = [];
  if (!/name: 'AutomationRecordThreadSafety'/.test(toolsSrc)) {
    reasons.push('automations.ts missing AutomationRecordThreadSafety tool');
  }
  if (!/export async function recordThreadSafety/.test(clientSrc)) {
    reasons.push('automation-client.mjs missing recordThreadSafety');
  }
  if (!/export async function enableAutomation/.test(clientSrc)) {
    reasons.push('automation-client.mjs missing enableAutomation');
  }
  if (!/AutomationRecordThreadSafety writes receipt/.test(testSrc)) {
    reasons.push('automations.test.ts missing receipt write coverage');
  }
  if (!/kind: 'enabled'/.test(testSrc) || !/AutomationEnable refuses when operator declines/.test(testSrc)) {
    reasons.push('automations.test.ts missing Enable-with-receipt and decline coverage');
  }
  if (!/All seven checks must pass/.test(clientSrc) && !/seven checks must pass/.test(clientSrc)) {
    reasons.push('recordThreadSafety must require all seven checks true');
  }
  if (!/ui\.confirm/.test(toolsSrc) || !/enableAutomation\(/.test(toolsSrc)) {
    reasons.push('AutomationEnable must confirm then call enableAutomation');
  }
  return { available: reasons.length === 0, reasons };
}

async function pathExists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function readText(path) {
  if (!(await pathExists(path))) return null;
  return readFile(path, 'utf8');
}

async function walkFind(dir, pred, out = [], depth = 0) {
  if (depth > 8) return out;
  let entries = [];
  try {
    const { readdir } = await import('node:fs/promises');
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    const abs = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === '.git') continue;
      await walkFind(abs, pred, out, depth + 1);
    } else if (entry.isFile() && pred(abs, entry.name)) {
      out.push(abs);
    }
  }
  return out;
}

export async function probeCreationBoundaryHost() {
  let cursorHelp = '';
  let cursorHelpExit = null;
  try {
    const { stdout, stderr } = await execFileAsync(cursorAgentBin, ['--help'], { timeout: 15_000 });
    cursorHelp = `${stdout}\n${stderr}`;
    cursorHelpExit = 0;
  } catch (error) {
    cursorHelp = String(error?.stdout || error?.stderr || error?.message || error);
    cursorHelpExit = typeof error?.code === 'number' ? error.code : 1;
  }

  const docsText = await readText(docsRetrieval);
  const setupText = await readText(setupBennySkill);
  const automateSkillHits = await walkFind(
    cursorAgentVersionRoot,
    (abs, name) =>
      name === 'SKILL.md' &&
      (/\/automate\//i.test(abs) || /\/skills\/automate\//i.test(abs)),
  );
  const automateNamedDirs = await walkFind(
    cursorAgentVersionRoot,
    (_abs, name) => /^automate$/i.test(name) === false && /automate\.md$/i.test(name),
  );

  const checks = {
    cursorAgentBinPresent: await pathExists(cursorAgentBin),
    cursorAgentHelpExit: cursorHelpExit,
    cursorAgentHelpMentionsAutomateSlash: /\/automate\b/i.test(cursorHelp),
    cursorAgentHelpMentionsAutomationsEditor: /Automations editor/i.test(cursorHelp),
    cursorAgentHelpMentionsAgentsWindow: /Agents Window/i.test(cursorHelp),
    cursorAgentHelpMentionsUpdateState: /update_state/i.test(cursorHelp),
    cursorAgentHelpMentionsWebhookRoutine: /webhook|routine/i.test(cursorHelp),
    cursorAgentBundleAutomateSkillMdCount: automateSkillHits.length,
    cursorAgentBundleAutomateMdCount: automateNamedDirs.length,
    docsRetrievalPresent: Boolean(docsText),
    docsSayAgentsWindowOrCursorAutomationsUrl: Boolean(
      docsText &&
        (/Agents Window/i.test(docsText) || /cursor\.com\/automations/i.test(docsText)),
    ),
    docsSayAutomateSkillPath: Boolean(docsText && /\/automate/i.test(docsText)),
    setupBennyCreationBoundaryPresent: Boolean(
      setupText && /Creation boundary/i.test(setupText) && /Automations editor handoff/i.test(setupText),
    ),
    piAutomateMePresent: await pathExists(piAutomateMe),
    // Flips true when extensions/pi-pstack/host/skills/automate/SKILL.md ships. Independent of editor chrome.
    piBuiltInAutomateSkillPresent: await pathExists(piAutomateSkill),
    // Stay false until a real in-PTY Automations editor surface exists (not a confirm/editor dialog stub alone).
    automationsEditorUiAvailableInCursorAgentPty: false,
    automationsEditorUiAvailableInPiPty: false,
    // Receipt tool only — does not claim live Slack seven-checks or thread-safety requirement verify.
    piThreadSafetyReceiptToolPresent: false,
    // Adapter text only — does not claim live Slack or paired journey verify.
    piSetupBennyAdapterUsesAutomatePath: false,
  };

  const piEditor = await detectPiAutomationsEditorChrome();
  checks.automationsEditorUiAvailableInPiPty = piEditor.available;
  const piThreadSafety = await detectPiThreadSafetyReceiptTool();
  checks.piThreadSafetyReceiptToolPresent = piThreadSafety.available;
  const piAdapter = await detectPiSetupBennyAdapterAutomatePath();
  checks.piSetupBennyAdapterUsesAutomatePath = piAdapter.available;

  const missing = [];
  if (!checks.cursorAgentBinPresent) missing.push('cursor-agent binary missing');
  if (!checks.cursorAgentHelpMentionsAutomateSlash) {
    missing.push('cursor-agent --help does not mention /automate');
  }
  if (!checks.cursorAgentHelpMentionsAutomationsEditor) {
    missing.push('cursor-agent --help does not mention Automations editor');
  }
  if (checks.cursorAgentBundleAutomateSkillMdCount === 0) {
    missing.push('no automate/SKILL.md found under locked cursor-agent 2026.10.01-e373342 bundle');
  }
  if (!checks.piBuiltInAutomateSkillPresent) {
    missing.push('Pi package has no host/skills/automate (only automate-me); no Automations editor handoff API');
  }
  if (!checks.automationsEditorUiAvailableInCursorAgentPty) {
    missing.push('Automations editor UI is not available inside cursor-agent PTY harness');
  }
  if (!checks.automationsEditorUiAvailableInPiPty) {
    missing.push(
      piEditor.reasons.length
        ? `Automations editor UI is not available inside Pi PTY harness (${piEditor.reasons.join('; ')})`
        : 'Automations editor UI is not available inside Pi PTY harness',
    );
  }
  if (!checks.piSetupBennyAdapterUsesAutomatePath) {
    missing.push(
      piAdapter.reasons.length
        ? `Pi setup-benny adapter is not on /automate path (${piAdapter.reasons.join('; ')})`
        : 'Pi setup-benny adapter is not on /automate path',
    );
  }
  if (checks.docsSayAgentsWindowOrCursorAutomationsUrl) {
    missing.push(
      'Cursor docs place creation at Agents Window / cursor.com/automations / local /automate, none of which the PTY harness can drive to editor save',
    );
  }

  const runnable = missing.length === 0;
  const cursorHelpDigest = createHash('sha256').update(cursorHelp).digest('hex');
  const probedAt = new Date().toISOString();

  return {
    scenario: 'setup-benny-creation-boundary',
    requirementId: 'PSTACK-SETUP-BENNY-CREATION-BOUNDARY-001',
    path: 'first-time-automate-editor-handoff',
    probedAt,
    runnable,
    verdict: runnable ? 'runnable' : 'blocker',
    checks,
    missing,
    evidenceNotes: {
      cursorHelpDigest: `sha256:${cursorHelpDigest}`,
      cursorHelpSnippet: cursorHelp.slice(0, 1200),
      automateSkillHits,
      docsRetrievalRel: 'parity/research/cursor-host/services/retrievals/docs_cloud-agent_automations.md',
      setupBennyLocator: '## 7. Prepare the live automations / ### Creation boundary',
      piAutomateSkillPathChecked: piAutomateSkill,
      piAutomateMePathChecked: piAutomateMe,
      piAutomationsEditorPathChecked: piAutomationsEditor,
      piAutomationsToolsPathChecked: piAutomationsTools,
      piAutomationsEditorTestPathChecked: piAutomationsEditorTest,
      piAutomationsEditorDetection: piEditor,
      piThreadSafetyReceiptDetection: piThreadSafety,
      piSetupBennyAdapterPathChecked: piSetupBennyAdapter,
      piSetupBennyAdapterDetection: piAdapter,
      ptyEditorNote:
        'piBuiltInAutomateSkillPresent tracks host/skills/automate/SKILL.md presence only. automationsEditorUiAvailableInPiPty flips true only when automations-editor.ts exports AUTOMATIONS_EDITOR_CHROME plus render/reduce, automations.ts opens via ctx.ui.custom (not ctx.ui.editor), and automations-editor.test.ts covers Inactive chrome with save/cancel. Creation-boundary requirement is verified-pass-paired separately (Pi 4d40a1d5 + Cursor e11d7225/475ab346). piThreadSafetyReceiptToolPresent means AutomationRecordThreadSafety can write thread-safety.json; it does not claim live Slack seven-checks or PSTACK-SETUP-BENNY-THREAD-SAFETY-001 verify. piSetupBennyAdapterUsesAutomatePath means host/adapters/benny/SKILL.md routes first-time Slack Benny through /automate + AutomationPrepare/OpenEditor and refuses webhook Routine* finish (design gap 6).',
    },
    skillAcceptanceNote:
      'setup-benny creation boundary requires finishing new automations only through the built-in automate skill reviewed Automations editor handoff, with no direct automation backend, draft-field browser URL, or Cursor protocol deep link, and no enablement before thread-safety after editor save. Paired Method A verify is separate from this host probe runnable flag.',
  };
}

if (isMain) {
  const result = await probeCreationBoundaryHost();
  await mkdir(evidenceRoot, { recursive: true });
  const outPath = join(evidenceRoot, 'host-env-probe.json');
  await writeFile(outPath, `${JSON.stringify(result, null, 2)}\n`);
  const helpPath = join(evidenceRoot, 'cursor-agent-help.txt');
  await writeFile(helpPath, `${result.evidenceNotes.cursorHelpSnippet}\n`);
  console.log(JSON.stringify({ ...result, wrote: outPath, helpSnippet: helpPath }, null, 2));
  process.exit(result.runnable ? 0 : 2);
}
