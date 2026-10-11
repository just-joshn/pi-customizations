import type { Host } from '../../src/core/host.ts';
import type { EditFormats } from '../../src/feature.ts';

export type CapturedHost = Host & { readonly outputs: string[]; readonly warnings: string[]; readonly errors: string[] };

/** A Host that records notices, confirms by default, and never runs real commands. */
export function capturedHost(overrides: Partial<Host> = {}): CapturedHost {
  const outputs: string[] = [];
  const warnings: string[] = [];
  const errors: string[] = [];
  return {
    outputs,
    warnings,
    errors,
    output: (text) => {
      outputs.push(text);
    },
    warning: (text) => {
      warnings.push(text);
    },
    error: (text) => {
      errors.push(text);
    },
    confirm: async () => true,
    select: async () => undefined,
    exec: async () => ({ stdout: '', stderr: '', code: 0, killed: false }),
    ...overrides,
  };
}

/** The edit port with Aider's defaults; tests pass the formats and tree plus whatever they vary. */
export function editPort(required: Pick<EditFormats, 'formats' | 'tree'> & Partial<EditFormats>): EditFormats {
  return {
    requestedFormat: 'whole',
    initialFiles: { editable: [], readOnly: [] },
    messageFile: null,
    applyFile: null,
    dryRun: false,
    yesAlways: true,
    autoAcceptArchitect: true,
    editorModel: null,
    chatLanguage: null,
    editorEditFormat: 'editor-whole',
    ...required,
  };
}
