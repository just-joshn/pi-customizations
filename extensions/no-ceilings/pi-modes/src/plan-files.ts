import { existsSync, readFileSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { z } from 'zod';
import { type CreatePlanInput, EIGHT, ONE, type PlanTodo, ZERO } from './types.ts';

const MAX_PLAN_NAME_LEN = 50;
const PLANS_SUBDIR_PI = '.pi';
const PLANS_SUBDIR_AGENT = 'agent';
const PLANS_SUBDIR_NAME = 'plans';
const FILE_URI_PREFIX = 'file:';
const FALLBACK_PLAN_NAME = 'Plan';

const EnvSchema = z.object({
  PI_MODES_PLANS_DIR: z.string().min(ONE).optional(),
});

function escapeYamlString(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n').replace(/\r/g, '\\r').replace(/\t/g, '\\t');
}

function serializeTodoLines(todo: PlanTodo, indent = ''): readonly string[] {
  const base = [`${indent}  - id: "${escapeYamlString(todo.id)}"`, `${indent}    content: "${escapeYamlString(todo.content)}"`, `${indent}    status: ${todo.status ?? 'pending'}`];
  const deps = todo.dependencies ?? [];
  if (deps.length === ZERO) {
    return base;
  }
  return [...base, `${indent}    dependencies:`, ...deps.map((dep) => `${indent}      - "${escapeYamlString(dep)}"`)];
}

function derivePlanTitle(planMarkdown: string): string {
  const heading = planMarkdown.match(/^#\s+(.+)$/m)?.[ONE]?.trim();
  if (heading) {
    return heading.slice(ZERO, MAX_PLAN_NAME_LEN);
  }
  const firstLine = planMarkdown
    .split('\n')
    .map((line) => line.trim())
    .find((line) => line.length > ZERO && !line.startsWith('#'));
  return firstLine ? firstLine.slice(ZERO, MAX_PLAN_NAME_LEN) : FALLBACK_PLAN_NAME;
}

function buildPlanFilename(name: string, sessionId: string): string {
  const cleaned = name
    .replace(/[^a-zA-Z0-9-_ ]/g, '')
    .trim()
    .slice(ZERO, MAX_PLAN_NAME_LEN);
  const baseName = cleaned.length > ZERO ? cleaned : FALLBACK_PLAN_NAME;
  const shortId = sessionId.replace(/[^a-zA-Z0-9]/g, '').slice(ZERO, EIGHT) || 'session';
  return `${baseName}-${shortId}.plan.md`;
}

function serializePhaseLines(phases: NonNullable<CreatePlanInput['phases']>): readonly string[] {
  if (phases.length === ZERO) {
    return [];
  }
  const items = phases.flatMap((phase) => [`  - name: "${escapeYamlString(phase.name)}"`, '    todos:', ...phase.todos.flatMap((todo) => serializeTodoLines(todo, '    '))]);
  return ['phases:', ...items];
}

function formatPlanMarkdown(input: CreatePlanInput, sessionId: string): string {
  const todos = input.todos ?? [];
  const isProject = input.is_project ?? false;
  const phases = input.phases ?? [];
  const hasFrontmatter = todos.length > ZERO || isProject;
  const header = `<!-- ${sessionId} -->`;
  if (!hasFrontmatter) {
    return `${header}\n${input.plan}`;
  }
  const todoLines = todos.length > ZERO ? ['todos:', ...todos.flatMap((todo) => serializeTodoLines(todo))] : [];
  const phaseLines = isProject ? serializePhaseLines(phases) : [];
  return [header, '---', ...todoLines, `isProject: ${String(isProject)}`, ...phaseLines, '---', input.plan].join('\n');
}

function resolvePlansDirectory(): string {
  const parsed = EnvSchema.safeParse(process.env);
  if (parsed.success && parsed.data.PI_MODES_PLANS_DIR) {
    return parsed.data.PI_MODES_PLANS_DIR;
  }
  return join(homedir(), PLANS_SUBDIR_PI, PLANS_SUBDIR_AGENT, PLANS_SUBDIR_NAME);
}

export interface SavedPlanFile {
  readonly planUri: string;
  readonly filePath: string;
  readonly created: boolean;
  readonly content: string;
}

export async function writePlanFile(input: CreatePlanInput, sessionId: string): Promise<SavedPlanFile> {
  const dir = resolvePlansDirectory();
  const title = input.name?.trim() || derivePlanTitle(input.plan);
  const filePath = join(dir, buildPlanFilename(title, sessionId));
  const existed = existsSync(filePath);
  const content = formatPlanMarkdown(input, sessionId);
  try {
    if (!existsSync(dir)) {
      await mkdir(dir, { recursive: true });
    }
    await writeFile(filePath, content, 'utf-8');
  } catch (error) {
    console.error('Failed to write plan file:', error);
    throw new Error(`Unable to save plan file to ${filePath}`, { cause: error });
  }
  return { planUri: pathToFileURL(filePath).toString(), filePath, created: !existed, content };
}

export function readPlanFileFromUri(planUri: string): string | undefined {
  if (!planUri.startsWith(FILE_URI_PREFIX)) {
    return undefined;
  }
  try {
    const filePath = fileURLToPath(planUri);
    return existsSync(filePath) ? readFileSync(filePath, 'utf-8') : undefined;
  } catch (error) {
    console.error('Failed to read plan file:', error);
    throw new Error(`Unable to read plan file from ${planUri}`, { cause: error });
  }
}
