import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

import { BUDGET_EFFORT, PANEL_ROLES, ROLE_NAMES, parseModelsConfig, type ModelsConfig, type Role } from '../src/models.js';

export function convertModelRule(markdown: string): ModelsConfig {
  const budgetLine = markdown.split(/\r?\n/).find((line) => /^# budget:/.test(line));
  const label = /^# budget:\s*(\w+)/.exec(budgetLine ?? '')?.[1];
  const budget = label && Object.hasOwn(BUDGET_EFFORT, label) ? label as ModelsConfig['budget'] : 'large';
  const roles: ModelsConfig['roles'] = {};
  for (const line of markdown.split(/\r?\n/)) {
    const match = /^([^#].*?):\s+(.+)$/.exec(line);
    if (!match || !ROLE_NAMES.includes(match[1] as Role)) continue;
    const role = match[1] as Role;
    const entries = match[2]!.split(/,\s*(?![^\[]*\])/).map((entry) => entry.trim());
    roles[role] = PANEL_ROLES.includes(role) ? entries : entries[0]!;
  }
  return parseModelsConfig({ schemaVersion: 1, budget, ...(budgetLine ? { budgetLine } : {}), roles });
}

export function migrateModelConfig(
  source = join(homedir(), '.pi/agent/pstack/pstack-models.md'),
  destination = join(homedir(), '.pi/agent/pstack/models.json'),
): ModelsConfig {
  if (existsSync(destination)) return parseModelsConfig(readFileSync(destination, 'utf8'));
  const config = convertModelRule(readFileSync(source, 'utf8'));
  mkdirSync(dirname(destination), { recursive: true });
  const temporary = `${destination}.${process.pid}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(config, null, 2)}\n`, { flag: 'wx' });
  renameSync(temporary, destination);
  return config;
}
