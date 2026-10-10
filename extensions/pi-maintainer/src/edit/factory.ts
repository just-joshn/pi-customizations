import type { Snapshot } from '../core/branch.ts';
import type { EditFormatName, RegisteredEditFormat } from '../feature.ts';

/** Aider `UnknownEditFormat` from `Coder.create` when no coder matches the requested name. */
export class UnknownEditFormat extends Error {
  readonly editFormat: string;
  readonly validFormats: readonly string[];

  constructor(editFormat: string, validFormats: readonly string[]) {
    super(`Unknown edit format ${editFormat}. Valid formats are: ${validFormats.join(', ')}`);
    this.name = 'UnknownEditFormat';
    this.editFormat = editFormat;
    this.validFormats = validFormats;
  }
}

export interface SelectEditFormatDefaults {
  /** Prior mode when cloning / transferring (`from_coder.edit_format`). */
  readonly inherited?: EditFormatName | null;
  /** Model default when neither a request nor an inherited mode is set. */
  readonly modelDefault: EditFormatName;
}

/**
 * Aider `Coder.create` format selection against the registered reply-text protocols.
 * `code` clears the request so the inherited or model-default format wins.
 */
export function selectEditFormat(formats: ReadonlyMap<EditFormatName, RegisteredEditFormat>, requested: string | null | undefined, defaults: SelectEditFormatDefaults): RegisteredEditFormat {
  const validFormats = [...formats.keys()];
  let editFormat: string | null | undefined = requested;
  if (editFormat === 'code') editFormat = null;
  if (editFormat == null) editFormat = defaults.inherited ?? defaults.modelDefault;
  const selected = formats.get(editFormat as EditFormatName);
  if (selected) return selected;
  throw new UnknownEditFormat(editFormat, validFormats);
}

/** Mode switch that keeps editable paths, read-only paths, declined mentions, and exchange fields. */
export function transferModeSelection(snapshot: Snapshot, mode: EditFormatName, options: { readonly oneShot?: boolean } = {}): Snapshot {
  return {
    ...snapshot,
    mode,
    returnMode: options.oneShot ? snapshot.mode : null,
  };
}
