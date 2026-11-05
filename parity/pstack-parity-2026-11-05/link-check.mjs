#!/usr/bin/env node
// Usage: link-check.mjs <package-dir> <out.json>
// Checks that the shipped text composes inside the Pi package: every relative Markdown link resolves to a file, and
// every skill a text names (`/name`, `**name** skill`, `principle-*`) is a shipped skill or a named host command.
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';

const [pkg, out] = process.argv.slice(2);
const skills = new Set(readdirSync(join(pkg, 'skills')).filter((name) => existsSync(join(pkg, 'skills', name, 'SKILL.md'))));
// Commands that a Pi session with pi-pstack provides outside the skills folder, plus Pi built-ins the text names.
const HOST_COMMANDS = new Set(['loop', 'mode', 'plan', 'routines', 'skill', 'resume', 'fork', 'tree', 'reload', 'model', 'login', 'export', 'new', 'compact']);
const files = [];
const walk = (dir) => {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (name === 'node_modules' || name === 'corpus') continue;
    if (statSync(path).isDirectory()) walk(path);
    else if (name.endsWith('.md')) files.push(path);
  }
};
for (const root of ['skills', 'agents', 'automations', 'docs/guide']) walk(join(pkg, root));
walk(pkg === '.' ? '.' : pkg);
const unique = [...new Set(files.filter((file) => !relative(pkg, file).startsWith('node_modules') && !relative(pkg, file).startsWith('coverage')))];

const brokenLinks = [];
const unknownSkills = [];
for (const file of unique) {
  const text = readFileSync(file, 'utf8');
  for (const [, target] of text.matchAll(/\]\(([^)\s#]+)(?:#[^)]*)?\)/g)) {
    if (/^[a-z]+:/i.test(target) || target.startsWith('/') || target.startsWith('<')) continue;
    if (!existsSync(resolve(dirname(file), target))) brokenLinks.push(`${relative(pkg, file)} -> ${target}`);
  }
  const named = new Set();
  for (const [, name] of text.matchAll(/(?:^|[\s(`])\/([a-z][a-z0-9-]+)(?=[\s`),.:]|$)/gm)) named.add(name);
  for (const [, name] of text.matchAll(/\*\*([a-z][a-z0-9-]+)\*\* (?:principle )?skill/g)) named.add(name);
  for (const [, name] of text.matchAll(/\b(principle-[a-z0-9-]+)/g)) named.add(name);
  for (const name of named) {
    const candidate = skills.has(name) || skills.has(`principle-${name}`) || HOST_COMMANDS.has(name);
    if (!candidate) unknownSkills.push(`${relative(pkg, file)}: ${name}`);
  }
}
writeFileSync(out, `${JSON.stringify({ files: unique.length, brokenLinks, unknownSkills }, null, 2)}\n`);
console.log(JSON.stringify({ files: unique.length, brokenLinks: brokenLinks.length, unknownNames: unknownSkills.length }));
