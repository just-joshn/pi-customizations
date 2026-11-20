import { readFileSync } from 'node:fs';

import { z } from 'zod';
import type { Catalog } from '../src/models.ts';

const CATALOG_MODEL = z.object({
  displayName: z.string().optional(),
  supportsImages: z.boolean().optional(),
  supportsThinking: z.boolean().optional(),
  maxTokens: z.number().optional(),
  maxOutputTokens: z.number().optional(),
});

const CATALOG = z.object({
  models: z.record(z.string(), CATALOG_MODEL).optional(),
  agentModelSorts: z.array(z.object({ groups: z.array(z.object({ modelIds: z.array(z.string()).optional() })).optional() })).optional(),
});

/** Reads the recorded `fetchAvailableModels` answer that the catalog tests share. */
export function loadCatalogFixture(): Catalog {
  const text = readFileSync(new URL('./catalog-fixture.json', import.meta.url), 'utf8');
  return CATALOG.parse(JSON.parse(text)) as Catalog;
}
