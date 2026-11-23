import { ONE, ZERO } from './types.ts';

const REPRO_STEPS_REGEX = /<reproduction_steps>([\s\S]*?)(?:<\/reproduction_steps>|$)/g;

export interface ExtractedReproductionSteps {
  readonly reproductionSteps: string | undefined;
}

export function extractReproductionSteps(text: string): ExtractedReproductionSteps {
  if (!text) {
    return { reproductionSteps: undefined };
  }
  const firstCapture = [...text.matchAll(REPRO_STEPS_REGEX)][ZERO]?.[ONE]?.trim();
  return { reproductionSteps: firstCapture && firstCapture.length > ZERO ? firstCapture : undefined };
}
