import { readdir, readFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const docPath = join(root, 'docs/native-gap.md');
const vendorDir = join(root, 'src/pi-ai');
const requiredGaps = ['cloud-code-stream', 'vendored-google-helpers'];
const requiredPoints = [1, 2, 3, 4, 5, 6, 7, 8];
const findings = [];

const doc = await readFile(docPath, 'utf8').catch(() => {
  findings.push(`missing ${relative(root, docPath)}`);
  return '';
});

if (doc) {
  for (const token of ['check:vendor', 'bun run vendor', 'check:native-gap']) {
    if (!doc.includes(token)) findings.push(`docs/native-gap.md must mention ${token}`);
  }

  for (const gap of requiredGaps) {
    if (!doc.includes(`## Gap: ${gap}`)) findings.push(`docs/native-gap.md missing "## Gap: ${gap}"`);
  }

  for (const gap of requiredGaps) {
    const section = sectionFor(doc, gap);
    if (!section) continue;
    for (const point of requiredPoints) {
      if (!section.includes(`### ${point}.`)) findings.push(`gap ${gap} missing checklist point ${point}`);
    }
  }

  const listed = inventory(doc);
  if (!listed) {
    findings.push('docs/native-gap.md missing ```native-gap-files inventory fence');
  } else {
    const vendorFiles = (await readdir(vendorDir)).filter((name) => name.endsWith('.ts')).sort();
    const expectedVendor = vendorFiles.map((name) => `src/pi-ai/${name}`);
    for (const path of expectedVendor) {
      if (!listed.has(path)) findings.push(`undocumented vendor file ${path}`);
    }
    for (const path of listed) {
      const absolute = join(root, path);
      const body = await readFile(absolute, 'utf8').catch(() => undefined);
      if (body === undefined) findings.push(`inventory cites missing file ${path}`);
    }
    for (const required of ['src/stream.ts', 'src/cloudcode.ts', 'src/oauth.ts']) {
      if (!listed.has(required)) findings.push(`inventory must include ${required}`);
    }
  }
}

if (findings.length) {
  process.stderr.write(`${findings.join('\n')}\n`);
  process.exitCode = 1;
} else {
  process.stdout.write(`native-gap ok (${requiredGaps.length} gaps, ${requiredPoints.length} points each)\n`);
}

function sectionFor(text, gap) {
  const start = text.indexOf(`## Gap: ${gap}`);
  if (start < 0) return undefined;
  const rest = text.slice(start);
  const next = rest.search(/\n## Gap: /);
  return next < 0 ? rest : rest.slice(0, next);
}

function inventory(text) {
  const match = text.match(/```native-gap-files\n([\s\S]*?)```/);
  if (!match) return undefined;
  return new Set(
    match[1]
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean),
  );
}
