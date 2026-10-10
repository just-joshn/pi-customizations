import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const settingsPath = join(dirname(fileURLToPath(import.meta.url)), 'model-map-settings.json');
const packagedUseRepoMap = new Set(JSON.parse(readFileSync(settingsPath, 'utf8')) as string[]);

/** Aider `apply_generic_model_settings` branches that set `use_repo_map = True`. */
function genericUseRepoMap(model: string): boolean {
  if (model.includes('/o3-mini')) return true;
  if (model.includes('gpt-4.1-mini')) return true;
  if (model.includes('gpt-4.1')) return true;

  const lastSegment = model.split('/').at(-1) ?? model;
  if (lastSegment === 'gpt-5' || lastSegment === 'gpt-5-2025-08-07') return false;

  if (model.includes('/o1-mini')) return true;
  if (model.includes('/o1-preview')) return true;
  if (model.includes('/o1')) return true;

  if (model.includes('deepseek') && model.includes('v3')) return true;
  if (model.includes('deepseek') && (model.includes('r1') || model.includes('reasoning'))) return true;
  if ((model.includes('llama3') || model.includes('llama-3')) && model.includes('70b')) return true;
  if (model.includes('gpt-4-turbo') || (model.includes('gpt-4-') && model.includes('-preview'))) return true;
  if (model.includes('gpt-4') || model.includes('claude-3-opus')) return true;
  if (model.includes('gpt-3.5') || model.includes('gpt-4')) return false;

  if (model.includes('sonnet-4-') || model.includes('opus-4-') || model.includes('haiku-4-')) return true;
  if (model.includes('3-7-sonnet')) return true;
  if (model.includes('3.5-sonnet') || model.includes('3-5-sonnet')) return true;

  if (model.startsWith('o1-') || model.includes('/o1-')) return false;

  if (model.includes('qwen') && model.includes('coder') && (model.includes('2.5') || model.includes('2-5')) && model.includes('32b')) {
    return true;
  }
  if (model.includes('qwq') && model.includes('32b') && !model.includes('preview')) return true;
  if (model.includes('qwen3') && model.includes('235b')) return true;

  return false;
}

/**
 * Repository mapping defaults off unless packaged settings or name heuristics enable it
 * (`aider/models.py:128-161,385-606`).
 */
export function resolveUseRepoMap(modelName: string, packaged: ReadonlySet<string> = packagedUseRepoMap): boolean {
  if (packaged.has(modelName)) return true;
  const lowered = modelName.toLowerCase();
  if (packaged.has(lowered)) return true;
  return genericUseRepoMap(lowered);
}
