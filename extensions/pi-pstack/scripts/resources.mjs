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
if (JSON.stringify(manifest.pi?.prompts) !== JSON.stringify(['./prompts']) || !manifest.files?.includes('prompts')) {
  throw new Error('Package must register and distribute the generated prompts directory.');
}
async function files(dir, installedDependencies = false) {
  const paths = [];
  for (const item of await readdir(dir, { withFileTypes: true })) {
    if (installedDependencies && item.name === 'node_modules' && item.isDirectory()) continue;
    const path = join(dir, item.name);
    if (item.isDirectory()) paths.push(...await files(path, installedDependencies));
    else if (item.isFile()) paths.push(path);
    else throw new Error(`Unexpected non-file ${path}`);
  }
  return paths.sort();
}
const inventories = await Promise.all(sources.map(async (source) => {
  const directory = join(root, source.directory);
  const inventory = JSON.parse(await readFile(join(root, source.inventory), 'utf8'));
  const actual = (await files(directory)).map((path) => relative(directory, path));
  if (JSON.stringify(actual) !== JSON.stringify(inventory.map((entry) => entry.path).sort())) {
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
const changes = [];
const outputs = [];
for (const entry of verified) {
  if (!entry.path.startsWith('skills/')) continue;
  let generated = entry.original;
  const transformations = [];
  if (entry.path.endsWith('.md')) {
    let text = entry.original.toString('utf8');
    if (/^skills\/[^/]+\/SKILL\.md$/.test(entry.path)) {
      const slug = entry.path.split('/')[1];
      const updated = text.replace(/^name: .+$/m, `name: ${slug}`);
      if (text !== updated) transformations.push('Normalize skill name to its directory slug for Pi discovery.');
      text = updated;
      const portable = text.replace(/^(---\r?\n)([\s\S]*?)(\r?\n---)/, (_match, start, frontmatter, end) =>
        start + frontmatter.replace(/^(?:mode|icon|color|reminder|paths):[^\n]*(?:\n|$)/gm, '') + end);
      if (text !== portable) transformations.push('Remove Reference-only frontmatter; Pi runtime behavior belongs to the extension.');
      text = portable;
    }
    let updated = text.replaceAll('~/.upstream/rules/pstack-models.mdc', '~/.pi/agent/pstack/models.mdc');
    if (text !== updated) transformations.push('Map model rule location to Pi agent configuration.');
    text = updated;
    updated = text.replaceAll('~/.upstream/skills', '~/.pi/agent/skills').replaceAll('.upstream/skills', '.pi/skills');
    if (text !== updated) transformations.push('Map user and project skill directories to Pi discovery locations.');
    generated = Buffer.from(updated);
  }
  const executable = (entry.mode & 0o111) !== 0;
  if (entry.path !== 'skills/bro/SKILL.md') {
    outputs.push({ source: entry.source, destination: entry.path, generated, mode: entry.mode, executable, transformations });
  }
  if (/^skills\/[^/]+\/SKILL\.md$/.test(entry.path)) {
    const slug = entry.path.split('/')[1];
    if (slug === 'poteto-mode' || slug === 'setup-pstack') continue;
    const body = generated.toString('utf8').replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, '').trim();
    const prompt = slug === 'bro' ? body : [
      `Read ${slug}/SKILL.md in full under the bundled pstack skills directory identified by the pstack host contract.`,
      'Follow those instructions, resolving references and supporting scripts relative to that skill directory.',
      'If the pstack host contract is unavailable, report that the package extension must be enabled to locate this bundled skill. Do not invent a path.',
    ].join('\n');
    outputs.push({
      source: entry.source, destination: `prompts/${slug}.md`,
      generated: Buffer.from(`---\ndescription: ${JSON.stringify(slug === 'bro' ? 'Restate the last message in plain human language, with no jargon.' : `Invoke the bundled ${slug} workflow.`)}\n---\n\n${prompt}\n\n$ARGUMENTS\n`),
      mode: 0o644, executable: false,
      transformations: [slug === 'bro' ? 'Classify reusable restatement text as a Pi prompt template.' : 'Expose the skill entry point as a native Pi prompt template with user arguments.'],
    });
  }
}
for (const output of outputs) {
  const { generated, executable, transformations } = output;
  const destination = join(root, output.destination);
  if (write) {
    await mkdir(dirname(destination), { recursive: true });
    await writeFile(destination, generated);
    await chmod(destination, output.mode);
  } else if (!(await readFile(destination)).equals(generated)) {
    throw new Error(`Generated resource drift: ${output.destination}. Run npm run generate.`);
  }
  if ((((await stat(destination)).mode & 0o111) !== 0) !== executable) throw new Error(`Executable mode drift: ${output.destination}`);
  changes.push({ source: output.source, destination: output.destination, sha256: sha(generated), executable, transformations });
}
if (write) {
  try {
    await unlink(join(root, 'skills/bro/SKILL.md'));
    await rmdir(join(root, 'skills/bro'));
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
}
const expected = changes.map((entry) => entry.destination).sort();
const generatedPaths = (await Promise.all(['skills', 'prompts'].map(directory => files(join(root, directory), true))))
  .flat().map((path) => relative(root, path)).sort();
if (JSON.stringify(expected) !== JSON.stringify(generatedPaths)) throw new Error('Unexpected generated resource files.');
const output = `${JSON.stringify(changes, null, 2)}\n`;
const mappingPath = join(root, 'docs/resource-map.json');
if (write) await writeFile(mappingPath, output);
else if ((await readFile(mappingPath, 'utf8')) !== output) throw new Error('Resource map drift.');
console.log(`Verified ${entries.length} upstream files and ${changes.length} generated resources.`);
