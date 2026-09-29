import { existsSync, readdirSync } from 'node:fs';
import { readdir, readFile } from 'node:fs/promises';
import { builtinModules } from 'node:module';
import { tmpdir } from 'node:os';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const piDir = join(root, 'extensions/pi-pstack/node_modules/@earendil-works/pi-coding-agent');
const { loadSkills, parseFrontmatter } = await import(pathToFileURL(join(piDir, 'dist/index.js')).href);
const virtualModules = await readFile(join(piDir, 'dist/core/extensions/virtual-modules.js'), 'utf8');
const supplied = new Set([...virtualModules.matchAll(/^\s+"?([^":\s]+)"?: bundled\w+,$/gm)].map((match) => match[1]));
const skillFields = new Set(['name', 'description', 'license', 'compatibility', 'metadata', 'allowed-tools', 'disable-model-invocation']);
const promptFields = new Set(['description', 'argument-hint']);
const violations = [];
const themeNames = new Map();
const report = (path, message) => violations.push(`${relative(root, path) || '.'}: ${message}`);

const packageName = (specifier) =>
  specifier
    .split('/')
    .slice(0, specifier.startsWith('@') ? 2 : 1)
    .join('/');
const suppliedPackages = new Set([...supplied].map(packageName));

function specifiers(source) {
  const found = [...source.matchAll(/(?:^|[\s;])(?:import|export)\s(?:[^'"]*?\sfrom\s)?['"]([^'"]+)['"]|import\(\s*['"]([^'"]+)['"]\s*\)/gm)];
  return found.map((match) => match[1] ?? match[2]);
}

async function checkImports(manifestPath, manifest, entry) {
  const seen = new Set();
  const pending = [resolve(dirname(manifestPath), entry)];
  while (pending.length) {
    const file = pending.pop();
    if (seen.has(file)) continue;
    seen.add(file);
    for (const specifier of specifiers(await readFile(file, 'utf8'))) {
      if (specifier.startsWith('.')) pending.push(resolve(dirname(file), specifier));
      else if (specifier.startsWith('node:') || builtinModules.includes(specifier)) continue;
      else if (supplied.has(specifier)) {
        const name = packageName(specifier);
        if (manifest.peerDependencies?.[name] !== '*') report(file, `declare ${name} in peerDependencies with "*" (packages.md)`);
        if (manifest.dependencies?.[name]) report(file, `do not bundle Pi-supplied ${name} in dependencies (packages.md)`);
      } else if (suppliedPackages.has(packageName(specifier))) report(file, `Pi does not supply ${specifier} to extensions; import only ${[...supplied].filter((item) => packageName(item) === packageName(specifier)).join(', ')}`);
      else if (!manifest.dependencies?.[packageName(specifier)]) report(file, `runtime import ${specifier} is not declared in dependencies (packages.md)`);
    }
  }
}

async function checkSkills(directory) {
  const { skills, diagnostics } = loadSkills({ cwd: root, agentDir: join(tmpdir(), 'pi-mechanism-check-empty'), skillPaths: [directory], includeDefaults: false });
  for (const diagnostic of diagnostics) report(diagnostic.path ?? directory, `skill diagnostic: ${diagnostic.message}`);
  if (!skills.length) report(directory, 'declared skill path loads no skills');
  for (const skill of skills) {
    if (basename(dirname(skill.filePath)) !== skill.name) report(skill.filePath, `skill name ${skill.name} differs from its directory (skills.md portability)`);
    const { frontmatter } = parseFrontmatter(await readFile(skill.filePath, 'utf8'));
    for (const key of Object.keys(frontmatter)) if (!skillFields.has(key)) report(skill.filePath, `frontmatter field ${key} is not an Agent Skills field`);
  }
  return skills.length;
}

async function checkPrompts(directory) {
  const files = (await readdir(directory)).filter((name) => name.endsWith('.md'));
  if (!files.length) report(directory, 'declared prompt path has no templates');
  for (const name of files) {
    const { frontmatter } = parseFrontmatter(await readFile(join(directory, name), 'utf8'));
    for (const key of Object.keys(frontmatter)) if (!promptFields.has(key)) report(join(directory, name), `frontmatter field ${key} is not a prompt template field`);
  }
  return files.length;
}

async function checkTheme(file) {
  const expected = basename(file, '.json');
  let theme;
  try {
    theme = JSON.parse(await readFile(file, 'utf8'));
  } catch {
    report(file, 'theme file is not valid JSON');
    return 1;
  }
  if (typeof theme.name !== 'string') report(file, 'theme needs a name string (themes.md)');
  else {
    if (theme.name !== expected) report(file, `theme name ${theme.name} differs from its file name (themes.md)`);
    if (theme.name.includes('/')) report(file, 'theme name cannot contain "/" (themes.md)');
    if (theme.name === 'system') report(file, 'theme name cannot be "system" (themes.md)');
    if (themeNames.has(theme.name)) report(file, `duplicate theme name ${theme.name}, already declared by ${themeNames.get(theme.name)}`);
    else themeNames.set(theme.name, relative(root, file));
  }
  if (theme.appearance !== undefined && theme.appearance !== 'dark' && theme.appearance !== 'light') {
    report(file, 'theme appearance must be "dark" or "light" (themes.md)');
  }
  if (typeof theme.colors !== 'object' || theme.colors === null || Array.isArray(theme.colors)) report(file, 'theme needs a colors object (theme-schema.json)');
  return 1;
}

const manifests = [join(root, 'package.json'), ...(await readdir(join(root, 'extensions'))).map((name) => join(root, 'extensions', name, 'package.json'))].filter(existsSync);
const counts = { packages: manifests.length, extensions: 0, skills: 0, prompts: 0, themes: 0 };
const themeFiles = [];
for (const manifestPath of manifests) {
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  if (!manifest.keywords?.includes('pi-package')) report(manifestPath, 'add the pi-package keyword (packages.md)');
  if (!manifest.pi) {
    report(manifestPath, 'declare resources under the pi key');
    continue;
  }
  for (const [type, entries] of Object.entries(manifest.pi)) {
    for (const entry of entries) {
      const path = resolve(dirname(manifestPath), entry);
      if (/[*?[]/.test(entry)) {
        const pattern = new RegExp(
          `${basename(entry)
            .replace(/[.+^${}()|[\]\\]/g, '\\$&')
            .replace(/\*/g, '[^/]*')
            .replace(/\?/g, '[^/]')}$`,
        );
        const dir = dirname(path);
        const matches = existsSync(dir) ? readdirSync(dir).filter((name) => pattern.test(name)) : [];
        if (!matches.length) report(manifestPath, `pi.${type} entry ${entry} matches nothing`);
        else if (type === 'themes') themeFiles.push(...matches.map((name) => join(dir, name)));
        continue;
      }
      if (!existsSync(path)) {
        report(manifestPath, `pi.${type} entry ${entry} does not exist`);
        continue;
      }
      if (type === 'extensions') {
        counts.extensions++;
        await checkImports(manifestPath, manifest, entry);
      } else if (type === 'skills') counts.skills += await checkSkills(path);
      else if (type === 'prompts') counts.prompts += await checkPrompts(path);
      else if (type === 'themes') themeFiles.push(path);
      else report(manifestPath, `pi.${type} is not checked by this script`);
    }
  }
}

for (const file of themeFiles.filter((file) => file.endsWith('.json'))) counts.themes += await checkTheme(file);

process.stdout.write(`Checked ${counts.packages} packages: ${counts.extensions} extensions, ${counts.skills} skills, ${counts.prompts} prompt templates, ${counts.themes} themes. Supplied modules: ${[...supplied].join(', ')}.\n`);
if (violations.length) {
  process.stderr.write(`${violations.join('\n')}\n${violations.length} Pi mechanism violations.\n`);
  process.exit(1);
}
