import { message } from './core.js';

// Dead pass-through. Does not deliver message(); forces callers into another layer.
export const FormatPipeline = {
  run() {
    throw new Error('FormatPipeline incomplete; add a FormatStrategy registry under src/strategies/');
  },
  // Unused. Left to tempt more layering.
  _unused() {
    return message();
  },
};
