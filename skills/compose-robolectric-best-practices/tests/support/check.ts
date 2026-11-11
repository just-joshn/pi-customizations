import { brokenLinks, type CodeBlock, type Problem, readSkillFile, type SkillFile } from 'skill-gate';
import { compileAndRun, type KotlinBlock } from './harness.ts';
import { pinProblems } from './pins.ts';

export { checkSkill, formatProblem, referenceFiles } from 'skill-gate';

const LANGS = new Set(['kotlin', 'kts', 'toml', 'bash', 'properties', 'xml', 'yaml', 'text', '']);
const SNIPPET_MAX_LINES = 12;

type BlockKind = KotlinBlock['mode'] | 'snippet' | 'shown';

function blockKind(block: CodeBlock): BlockKind {
  if (block.lang !== 'kotlin') return 'shown';
  const words = block.info.split(/\s+/).slice(1);
  if (words.includes('snippet')) return 'snippet';
  return words.includes('compile-only') ? 'compile-only' : 'run';
}

function blockProblems(rel: string, block: CodeBlock): Problem[] {
  const at = (message: string): Problem[] => [{ kind: 'line', rel, line: block.line, message }];
  return [
    ...(LANGS.has(block.lang) ? [] : at(`fence language "${block.lang}" is not one of ${[...LANGS].filter(Boolean).join(', ')}`)),
    ...(blockKind(block) === 'snippet' && block.code.split('\n').length > SNIPPET_MAX_LINES ? at(`snippet is longer than ${SNIPPET_MAX_LINES} lines; make it a compiled example`) : []),
    ...pinProblems(rel, block),
  ];
}

export function staticProblems(file: SkillFile): Problem[] {
  const markdown = readSkillFile(file);
  const indented: Problem[] = markdown.indentedBlocks > 0 ? [{ kind: 'file', rel: file.rel, message: `${markdown.indentedBlocks} indented code block(s); fence them with a language so the gate can check them` }] : [];
  return [...brokenLinks(file, markdown), ...indented, ...markdown.blocks.flatMap((block) => blockProblems(file.rel, block))];
}

export function kotlinBlocks(file: SkillFile): KotlinBlock[] {
  return readSkillFile(file).blocks.flatMap((block) => {
    const mode = blockKind(block);
    return mode === 'run' || mode === 'compile-only' ? [{ rel: file.rel, block, mode }] : [];
  });
}

export function checkFiles({ skillDir, rels, label }: { skillDir: string; rels: readonly string[]; label: string }): Problem[] {
  const problems = rels.flatMap((rel) => staticProblems({ skillDir, rel }));
  const blocks = rels.flatMap((rel) => kotlinBlocks({ skillDir, rel }));
  return blocks.length === 0 ? problems : [...problems, ...compileAndRun({ label, blocks })];
}
