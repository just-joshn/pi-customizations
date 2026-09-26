import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdir, readdir, chmod, stat } from 'node:fs/promises';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const source = join(root, 'upstream');
const write = process.argv.includes('--write');
const inventory = JSON.parse(await readFile(join(root, 'docs/source-inventory.json'), 'utf8'));
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
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
const actual = (await files(source)).map((path) => relative(source, path));
if (JSON.stringify(actual) !== JSON.stringify(inventory.map((entry) => entry.path).sort())) {
  throw new Error('Upstream file inventory differs from the pinned source.');
}
const changes = [];
for (const entry of inventory) {
  const path = join(source, entry.path);
  const original = await readFile(path);
  if (sha(original) !== entry.sha256) throw new Error(`Upstream hash mismatch: ${entry.path}`);
  if (!entry.path.startsWith('skills/')) continue;
  let generated = original;
  const transformations = [];
  if (entry.path.endsWith('.md')) {
    let text = original.toString('utf8');
    if (/^skills\/[^/]+\/SKILL\.md$/.test(entry.path)) {
      const slug = entry.path.split('/')[1];
      const updated = text.replace(/^name: .+$/m, `name: ${slug}`);
      if (text !== updated) transformations.push('Normalize skill name to its directory slug for Pi discovery.');
      text = updated;
    }
    let updated = text.replaceAll('~/.cursor/rules/pstack-models.mdc', '~/.pi/agent/pstack/models.mdc');
    if (text !== updated) transformations.push('Map model rule location to Pi agent configuration.');
    text = updated;
    updated = text.replaceAll('~/.cursor/skills', '~/.pi/agent/skills').replaceAll('.cursor/skills', '.pi/skills');
    if (text !== updated) transformations.push('Map user and project skill directories to Pi discovery locations.');
    generated = Buffer.from(updated);
  }
  const destination = join(root, entry.path);
  const executable = ((await stat(path)).mode & 0o111) !== 0;
  if (write) {
    await mkdir(dirname(destination), { recursive: true });
    await writeFile(destination, generated);
    await chmod(destination, (await stat(path)).mode & 0o777);
  } else if (!(await readFile(destination)).equals(generated)) {
    throw new Error(`Generated resource drift: ${entry.path}. Run npm run generate.`);
  }
  if ((((await stat(destination)).mode & 0o111) !== 0) !== executable) throw new Error(`Executable mode drift: ${entry.path}`);
  changes.push({ source: `upstream/${entry.path}`, destination: entry.path, sha256: sha(generated), executable, transformations });
}
const expected = changes.map((entry) => entry.destination).sort();
const generatedPaths = (await files(join(root, 'skills'), true)).map((path) => relative(root, path));
if (JSON.stringify(expected) !== JSON.stringify(generatedPaths)) throw new Error('Unexpected generated skill files.');
const output = `${JSON.stringify(changes, null, 2)}\n`;
const mappingPath = join(root, 'docs/resource-map.json');
if (write) await writeFile(mappingPath, output);
else if ((await readFile(mappingPath, 'utf8')) !== output) throw new Error('Resource map drift.');
console.log(`Verified ${inventory.length} upstream files and ${changes.length} generated skill resources.`);
