import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

export const RESOURCE_RECORDER_MODEL = 'resource-recorder/recorder';

const SKILL_BLOCK = /^<skill name="([^"]+)" location="([^"]+)">\n([\s\S]*?)\n<\/skill>(?:\n\n([\s\S]+))?$/;

export function readSurfaces(repoRoot) {
  const lines = readFileSync(join(repoRoot, 'docs/user-perspective-testing/surfaces.tsv'), 'utf8').replace(/\n$/, '').split('\n');
  const columns = lines.shift().split('\t');
  return lines.map((line) => Object.fromEntries(columns.map((column, index) => [column, line.split('\t')[index]])));
}

/** Bare resource name, stripping the tsv's backticks and any leading slash. */
export function surfaceName(row) {
  return row.name.replace(/^`|`$/g, '').replace(/^\//, '');
}

export function resourceRows(repoRoot) {
  return readSurfaces(repoRoot).filter((row) => row.kind === 'skill' || row.kind === 'prompt-template' || row.kind === 'agent');
}

/**
 * Pi 1.0.4's parseFrontmatter body, ported: a document with frontmatter gets
 * `normalized.slice(endIndex + 4).trim()`, and one without is returned normalized and untrimmed.
 * Skill expansion trims the result again; prompt template content uses it as-is. This is an
 * independent port so the comparison does not call the production parser it is checking.
 */
export function stripFrontmatter(content) {
  const normalized = content
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/^\uFEFF/, '');
  if (!normalized.startsWith('---')) return normalized;
  const endIndex = normalized.indexOf('\n---', 3);
  if (endIndex === -1) return normalized;
  return normalized.slice(endIndex + 4).trim();
}

export function parseInjectedSkill(text) {
  const match = typeof text === 'string' ? text.match(SKILL_BLOCK) : null;
  if (!match) return null;
  return { name: match[1], location: match[2], content: match[3], userMessage: match[4]?.trim() };
}

/** Pi 1.0.4 prompt-templates.js parseCommandArgs, ported. */
export function parseCommandArgs(argsString) {
  const args = [];
  let current = '';
  let inQuote = null;
  for (const char of argsString) {
    if (inQuote) {
      if (char === inQuote) inQuote = null;
      else current += char;
    } else if (char === '"' || char === "'") {
      inQuote = char;
    } else if (/\s/.test(char)) {
      if (current) {
        args.push(current);
        current = '';
      }
    } else {
      current += char;
    }
  }
  if (current) args.push(current);
  return args;
}

/** Pi 1.0.4 prompt-templates.js substituteArgs, ported. */
export function substituteArguments(content, args) {
  const allArgs = args.join(' ');
  return content.replace(/\$\{(\d+|ARGUMENTS|@):-([^}]*)\}|\$\{@:(\d+)(?::(\d+))?\}|\$(ARGUMENTS|@|\d+)/g, (_match, defaultTarget, defaultValue, sliceStart, sliceLength, simple) => {
    if (defaultTarget) {
      const value = defaultTarget === '@' || defaultTarget === 'ARGUMENTS' ? allArgs : args[Number.parseInt(defaultTarget, 10) - 1];
      return value ? value : defaultValue;
    }
    if (sliceStart) {
      let start = Number.parseInt(sliceStart, 10) - 1;
      if (start < 0) start = 0;
      if (sliceLength) return args.slice(start, start + Number.parseInt(sliceLength, 10)).join(' ');
      return args.slice(start).join(' ');
    }
    if (simple === 'ARGUMENTS' || simple === '@') return allArgs;
    return args[Number.parseInt(simple, 10) - 1] ?? '';
  });
}

export function encodePromptArgument(value) {
  return `'${value.replaceAll("'", "'\"'\"'")}'`;
}

function snippet(text, limit = 120) {
  const value = typeof text === 'string' ? text : '';
  return value.length > limit ? `${value.slice(0, limit)}…` : value;
}

function firstDivergence(actual, expected) {
  const limit = Math.min(actual.length, expected.length);
  for (let index = 0; index < limit; index++) {
    if (actual[index] !== expected[index]) return `index ${index} (actual ${JSON.stringify(snippet(actual.slice(index, index + 40), 40))}, expected ${JSON.stringify(snippet(expected.slice(index, index + 40), 40))})`;
  }
  return actual.length === expected.length ? 'none' : `length ${actual.length} vs ${expected.length}`;
}

export function compareSkillInjection({ userTexts, name, location, body, args }) {
  const blocks = (userTexts ?? [])
    .map(parseInjectedSkill)
    .filter(Boolean)
    .filter((block) => block.name === name);
  const block = blocks.at(-1);
  if (!block) return { ok: false, diff: `no <skill name="${name}"> block in recorded user messages ${JSON.stringify((userTexts ?? []).map((text) => snippet(text)))}` };
  // Pi and pstack both emit `References are relative to <baseDir>.` between the tag and the body.
  const expectedContent = `References are relative to ${dirname(location)}.\n\n${body}`;
  const diffs = [];
  if (block.name !== name) diffs.push(`name ${JSON.stringify(block.name)} != ${JSON.stringify(name)}`);
  if (block.location !== location) diffs.push(`location ${block.location} != ${location}`);
  if (block.content !== expectedContent) diffs.push(`block content differs at ${firstDivergence(block.content, expectedContent)}`);
  if (args) {
    if (block.userMessage !== args) diffs.push(`sentinel args ${JSON.stringify(block.userMessage)} != ${JSON.stringify(args)}`);
  } else if (block.userMessage !== undefined) {
    diffs.push(`unexpected trailing args ${JSON.stringify(block.userMessage)}`);
  }
  return { ok: diffs.length === 0, diff: diffs.join('; ') };
}

export function comparePromptExpansion({ userTexts, content, args }) {
  const expected = substituteArguments(content, parseCommandArgs(args));
  const texts = userTexts ?? [];
  if (texts.includes(expected)) return { ok: true, expected, diff: '' };
  return { ok: false, expected, diff: `no recorded user message equals the expanded template; recorded ${JSON.stringify(texts.map((text) => snippet(text)))}` };
}

export function readJsonl(path) {
  try {
    return readFileSync(path, 'utf8')
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line));
  } catch {
    return [];
  }
}

/**
 * Each session gets its own scratch agent dir. The recorder provider is both copied into
 * `agentDir/extensions/` and named in `settings.json`, because a spawned worker loads its own
 * extension set from the agent dir rather than sharing the parent's in-process registry.
 */
export function prepareRecorderDir(context, key, providerSource) {
  const agentDir = join(context.scratchDir, key);
  mkdirSync(join(agentDir, 'extensions'), { recursive: true });
  const providerPath = join(agentDir, 'extensions', 'resource-recorder-provider.mjs');
  copyFileSync(providerSource, providerPath);
  const recorderPath = join(agentDir, 'records.jsonl');
  const inputLogPath = join(agentDir, 'inputs.jsonl');
  writeFileSync(recorderPath, '');
  writeFileSync(inputLogPath, '');
  writeFileSync(join(agentDir, 'settings.json'), `${JSON.stringify({ defaultModel: RESOURCE_RECORDER_MODEL, extensions: ['extensions/resource-recorder-provider.mjs'], quietStartup: true }, null, 2)}\n`);
  return { agentDir, providerPath, recorderPath, inputLogPath };
}

export function childRecord(records, driveText) {
  return records.find((record) => typeof record.userText === 'string' && record.userText.length > 0 && record.userText !== driveText);
}

/** Every non-empty literal run between `{{placeholder}}` spans must appear in the recorded prompt. */
export function literalSegments(source) {
  return source
    .split(/\{\{[^}]*\}\}/)
    .map((segment) => segment.trim())
    .filter((segment) => segment.length > 0);
}

export function templateLiteral(source, exportName) {
  const match = source.match(new RegExp(`export const ${exportName} = \`([\\s\\S]*?)\`;`));
  return match ? match[1] : null;
}

/** A plain single-quoted module const, such as personas.ts's `shell` and `explore` strings. */
export function singleQuotedConst(source, name) {
  const match = source.match(new RegExp(`const ${name} =\\s*'([^']*)';`));
  return match ? match[1] : null;
}
