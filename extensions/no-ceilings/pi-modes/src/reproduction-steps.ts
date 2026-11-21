import { ONE, ZERO } from './types.ts';

const REPRO_STEPS_REGEX = /<reproduction_steps>([\s\S]*?)(?:<\/reproduction_steps>|$)/g;

export interface ExtractedReproductionSteps {
  readonly textWithoutReproductionSteps: string;
  readonly reproductionSteps: string | undefined;
}

export function extractReproductionSteps(text: string): ExtractedReproductionSteps {
  if (!text) {
    return { textWithoutReproductionSteps: '', reproductionSteps: undefined };
  }
  const stripped = text.replace(REPRO_STEPS_REGEX, '').trim();
  const firstCapture = [...text.matchAll(REPRO_STEPS_REGEX)][ZERO]?.[ONE]?.trim();
  return {
    textWithoutReproductionSteps: stripped,
    reproductionSteps: firstCapture && firstCapture.length > ZERO ? firstCapture : undefined,
  };
}
