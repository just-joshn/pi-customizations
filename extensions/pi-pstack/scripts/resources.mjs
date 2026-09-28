import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdir, readdir, chmod, stat, unlink, rmdir } from 'node:fs/promises';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const sources = [
  { directory: 'upstream', inventory: 'docs/source-inventory.json' },
  { directory: 'upstream-team-kit', inventory: 'docs/team-kit-source-inventory.json' },
];
const write = process.argv.includes('--write');
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
const manifest = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
if (!manifest.pi?.prompts?.includes('./prompts') || !manifest.files?.includes('prompts')) {
  throw new Error('Package must register and distribute the generated prompts directory.');
}
async function files(dir, installedDependencies = false) {
  const items = await readdir(dir, { withFileTypes: true });
  const paths = await Promise.all(items.map(async item => {
    if (installedDependencies && item.name === 'node_modules' && item.isDirectory()) return [];
    const path = join(dir, item.name);
    if (item.isDirectory()) return files(path, installedDependencies);
    if (item.isFile()) return [path];
    throw new Error(`Unexpected non-file ${path}`);
  }));
  return paths.flat().toSorted();
}
const inventories = await Promise.all(sources.map(async (source) => {
  const directory = join(root, source.directory);
  const inventory = JSON.parse(await readFile(join(root, source.inventory), 'utf8'));
  const actual = (await files(directory)).map((path) => relative(directory, path));
  if (JSON.stringify(actual) !== JSON.stringify(inventory.map((entry) => entry.path).toSorted())) {
    throw new Error(`Upstream file inventory differs from the pinned source: ${source.directory}.`);
  }
  return inventory.map((entry) => ({ ...entry, source: `${source.directory}/${entry.path}` }));
}));
const entries = inventories.flat();
const destinations = entries.filter((entry) => entry.path.startsWith('skills/')).map((entry) => entry.path);
if (new Set(destinations).size !== destinations.length) throw new Error('Duplicate generated skill destination across source bundles.');
const verified = await Promise.all(entries.map(async (entry) => {
  const path = join(root, entry.source);
  const original = await readFile(path);
  if (sha(original) !== entry.sha256) throw new Error(`Upstream hash mismatch: ${entry.source}`);
  return { ...entry, original, mode: (await stat(path)).mode & 0o777 };
}));
const markdownFiles = /\.md$/;
const worktreeAudit = /^skills\/poteto-mode\/scripts\/worktree-audit\.sh$/;
const modelRule = 'Map model rule location to Pi agent configuration.';
const skillDirectories = 'Map user and project skill directories to Pi discovery locations.';
const transcripts = 'Map Reference agent-transcripts to the Pi session store and pstack-workers child transcripts.';
const portableDates = 'Replace BSD-only stat and date calls with Perl so transcript dates survive GNU or uutils coreutils on PATH.';
const repositorySkills = 'Map the upstream repository path for the bundled skills to this repository layout.';
const hostPaths = [
  [markdownFiles, 'Look recursively for `.upstream/skills/**/*-mode/SKILL.md` and `~/.upstream/skills/*-mode/SKILL.md`',
    'Look recursively for `.pi/skills/**/*-mode/SKILL.md`, `.agents/skills/**/*-mode/SKILL.md`, `<agent-dir>/skills/*-mode/SKILL.md` (`~/.pi/agent/skills` by default), and `~/.agents/skills/*-mode/SKILL.md`', skillDirectories],
  [markdownFiles, '~/.upstream/rules/pstack-models.mdc', '~/.pi/agent/pstack/models.mdc', modelRule],
  [markdownFiles, '~/.upstream/skills', '~/.pi/agent/skills', skillDirectories],
  [markdownFiles, '.upstream/skills', '.pi/skills', skillDirectories],
  [markdownFiles, 'or plugin-installed paths under `~/.upstream/plugins/`', 'or Pi package skill paths such as the bundled pstack skills directory named by the host contract', skillDirectories],
  [markdownFiles, 'Transcripts live at `~/.upstream/projects/<slug>/agent-transcripts/<uuid>/<uuid>.jsonl`, where `<slug>` is the workspace path with the leading slash dropped and each "/" turned into "-" (so `/Users/you/proj` becomes `Users-you-proj`). Every line is one chat message.',
    'Transcripts live in the workspace Pi session directory that the pstack host contract names. Read that path. Pi\'s `sessionDir` setting, `PI_CODING_AGENT_SESSION_DIR`, and `--session-dir` can move it. By default transcripts live at `~/.pi/agent/sessions/<slug>/<timestamp>_<uuid>.jsonl`, with Task subagent transcripts under `<slug>/pstack-workers/<parent-uuid>/`. `<slug>` is the workspace path with the leading slash dropped, each "/", "\\", and ":" turned into "-", and `--` added at both ends (so `/Users/you/proj` becomes `--Users-you-proj--`). Every line is one session entry.', transcripts],
  [markdownFiles, 'ls -t <agent-transcripts>/*.jsonl <agent-transcripts>/*/*.jsonl <agent-transcripts>/*/subagents/*.jsonl', 'ls -t <session-dir>/*.jsonl <session-dir>/pstack-workers/*/*.jsonl', transcripts],
  [markdownFiles, 'Three transcript layouts: legacy flat (`<id>.jsonl`), current nested (`<id>/<id>.jsonl`), and subagent (`<parent>/subagents/<child>.jsonl`).',
    'Two transcript layouts: session (`<timestamp>_<id>.jsonl`) and Task subagent (`pstack-workers/<parent>/<timestamp>_<child>.jsonl`).', transcripts],
  [markdownFiles, 'read the first JSONL line and check that `message.content[0].text`', 'read the first JSONL line whose `message.role` is `user` and check that its `message.content` (a string, or the `text` of its first text block)', transcripts],
  [markdownFiles, '`agent-transcripts/` directory', 'Pi session directory', transcripts],
  [markdownFiles, 'under `agent-transcripts/`', 'under the Pi session directory', transcripts],
  [markdownFiles, '`~/.upstream/projects/*/`', '`~/.pi/agent/sessions/*/`', transcripts],
  [markdownFiles, 'pstack/skills/', 'extensions/pi-pstack/skills/', repositorySkills],
  [worktreeAudit, `# Transcripts dir: ~/.upstream/projects/<slugified-repo-path>/agent-transcripts.\nslug=$(printf '%s' "$main_wt" | sed 's#^/##; s#/#-#g')\ntranscripts="$HOME/.upstream/projects/$slug/agent-transcripts"`,
    `# Pi session dirs: <agent-dir>/sessions/--<repo path with / and : as ->--, including pstack-workers.\nsessions="\${PI_CODING_AGENT_DIR:-$HOME/.pi/agent}"; sessions="\${sessions/#\\~/$HOME}/sessions"\nsession_dir() { printf '%s/--%s--' "$sessions" "$(printf '%s' "$1" | sed 's#^/##; s#[/:]#-#g')"; }\ntranscripts=$(session_dir "$main_wt")`, transcripts],
  [worktreeAudit, `\tif [ -d "$transcripts" ]; then\n\t\tf=$(rg -l -e "\${wt}/" -e "\${wt}\\"" "$transcripts" 2>/dev/null`,
    `\twt_sessions=$(session_dir "$wt")\n\tif [ -d "$transcripts" ] || [ -d "$wt_sessions" ]; then\n\t\tf=$(rg -l -e "\${wt}/" -e "\${wt}\\"" "$transcripts" "$wt_sessions" 2>/dev/null`, transcripts],
  [worktreeAudit, `| xargs stat -f '%m %N' 2>/dev/null`, `| xargs perl -e 'printf "%d %s\\n", (stat)[9], $_ for @ARGV' 2>/dev/null`, portableDates],
  [worktreeAudit, `last=$(date -r "$last_ts" '+%Y-%m-%d' 2>/dev/null)`, `last=$(perl -MPOSIX -e 'print strftime("%Y-%m-%d", localtime shift)' "$last_ts" 2>/dev/null)`, portableDates],
];
const appliedHostPaths = new Set();
function mapHostPaths(entry, text) {
  return hostPaths.reduce(({ text, transformations }, row) => {
    const [scope, from, to, reason] = row;
    if (!scope.test(entry.path) || !text.includes(from)) return { text, transformations };
    appliedHostPaths.add(row);
    return { text: text.replaceAll(from, to), transformations: transformations.includes(reason) ? transformations : [...transformations, reason] };
  }, { text, transformations: [] });
}

function markdown(entry) {
  let text = entry.original.toString('utf8');
  let transformations = [];
  if (/^skills\/[^/]+\/SKILL\.md$/.test(entry.path)) {
    const slug = entry.path.split('/')[1];
    const updated = text.replace(/^name: .+$/m, `name: ${slug}`);
    if (text !== updated) transformations = [...transformations, 'Normalize skill name to its directory slug for Pi discovery.'];
    text = updated;
    const pathTriggered = /^---\r?\n[\s\S]*?^paths:/m.test(text);
    const portable = text.replace(/^(---\r?\n)([\s\S]*?)(\r?\n---)/, (_match, start, frontmatter, end) =>
      start + frontmatter.replace(/^(?:mode|icon|color|reminder|paths):[^\n]*(?:\n|$)/gm, '') + end);
    if (text !== portable) transformations = [...transformations, 'Remove Reference-only frontmatter; Pi runtime behavior belongs to the extension.'];
    text = portable;
    if (pathTriggered) {
      text = text.replace(/^disable-model-invocation: true\r?\n/m, '');
      transformations = [...transformations, 'Pi has no file-path skill trigger, so let the description route the skill instead of hiding it.'];
    }
    if (slug === 'setup-pstack') {
      text = text.replace(/^(---\r?\n[\s\S]*?)(\r?\n---)/, '$1\ndisable-model-invocation: true$2');
      transformations = [...transformations, 'Hide the skill from automatic selection; the extension\'s /setup-pstack and /skill:setup-pstack handlers own the validated dialogs.'];
    }
  }
  const mapped = mapHostPaths(entry, text);
  return { generated: Buffer.from(mapped.text), transformations: [...transformations, ...mapped.transformations] };
}

function script(entry) {
  if (!worktreeAudit.test(entry.path)) return { generated: entry.original, transformations: [] };
  const mapped = mapHostPaths(entry, entry.original.toString('utf8'));
  return { generated: Buffer.from(mapped.text), transformations: mapped.transformations };
}

function promptOutput(entry, generated) {
  if (!/^skills\/[^/]+\/SKILL\.md$/.test(entry.path)) return [];
  const slug = entry.path.split('/')[1];
  if (slug === 'poteto-mode' || slug === 'setup-pstack') return [];
  const body = generated.toString('utf8').replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, '').trim();
  const prompt = slug === 'bro' ? body : [
    `Read ${slug}/SKILL.md in full under the bundled pstack skills directory identified by the pstack host contract.`,
    'Follow those instructions, resolving references and supporting scripts relative to that skill directory.',
    'If the pstack host contract is unavailable, report that the package extension must be enabled to locate this bundled skill. Do not invent a path.',
  ].join('\n');
  return [{
    source: entry.source, destination: `prompts/${slug}.md`,
    generated: Buffer.from(`---\ndescription: ${JSON.stringify(slug === 'bro' ? 'Restate the last message in plain human language, with no jargon.' : `Invoke the bundled ${slug} workflow.`)}\nargument-hint: ${JSON.stringify(slug === 'bro' ? '[focus]' : '[task]')}\n---\n\n${prompt}\n\n$ARGUMENTS\n`),
    mode: 0o644, executable: false,
    transformations: [slug === 'bro' ? 'Classify reusable restatement text as a Pi prompt template.' : 'Expose the skill entry point as a native Pi prompt template with user arguments.'],
  }];
}

const outputs = verified.filter(entry => entry.path.startsWith('skills/')).flatMap(entry => {
  const { generated, transformations } = entry.path.endsWith('.md') ? markdown(entry) : script(entry);
  const executable = (entry.mode & 0o111) !== 0;
  const skill = { source: entry.source, destination: entry.path, generated, mode: entry.mode, executable, transformations };
  return [...(entry.path === 'skills/bro/SKILL.md' ? [] : [skill]), ...promptOutput(entry, generated)];
});
const unusedHostPaths = hostPaths.filter(row => !appliedHostPaths.has(row));
if (unusedHostPaths.length) throw new Error(`Host path mapping no longer matches upstream: ${unusedHostPaths.map(row => row[1].split('\n')[0]).join('; ')}`);
for (const output of outputs) {
  const { generated, executable } = output;
  const destination = join(root, output.destination);
  if (write) {
    await mkdir(dirname(destination), { recursive: true });
    await writeFile(destination, generated);
    await chmod(destination, output.mode);
  } else if (!(await readFile(destination)).equals(generated)) {
    throw new Error(`Generated resource drift: ${output.destination}. Run npm run generate.`);
  }
  if ((((await stat(destination)).mode & 0o111) !== 0) !== executable) throw new Error(`Executable mode drift: ${output.destination}`);
}
if (write) {
  try {
    await unlink(join(root, 'skills/bro/SKILL.md'));
    await rmdir(join(root, 'skills/bro'));
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
}
const changes = outputs.map(({ source, destination, generated, executable, transformations }) => ({
  source, destination, sha256: sha(generated), executable, transformations,
}));
const expected = changes.map((entry) => entry.destination).toSorted();
const generatedPaths = (await Promise.all(['skills', 'prompts'].map(directory => files(join(root, directory), true))))
  .flat().map((path) => relative(root, path)).toSorted();
if (JSON.stringify(expected) !== JSON.stringify(generatedPaths)) throw new Error('Unexpected generated resource files.');
const output = `${JSON.stringify(changes, null, 2)}\n`;
const mappingPath = join(root, 'docs/resource-map.json');
if (write) await writeFile(mappingPath, output);
else if ((await readFile(mappingPath, 'utf8')) !== output) throw new Error('Resource map drift.');
process.stdout.write(`Verified ${entries.length} upstream files and ${changes.length} generated resources.\n`);
