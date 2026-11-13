// An assignment's model spec: `inherit-parent`, `<provider>/<id>`, or a family default as the skills write it.
// Dependency-free because the worker host bundles it with run-files.ts.
export const FAMILY_DEFAULT_LEVELS = ['minimal', 'low', 'medium', 'high', 'xhigh', 'max'] as const;
export type FamilyDefaultLevel = (typeof FAMILY_DEFAULT_LEVELS)[number];

export interface FamilyDefault {
  /** The model id before the level, such as `claude-opus-5-5` or `grok-4.7`. */
  id: string;
  level: FamilyDefaultLevel;
  /** The spec ended in `-fast`: the model's fast variant (`<id>-fast`) when one exists. */
  fast: boolean;
}

const FAMILY_DEFAULT = new RegExp(`^([a-z][a-z0-9]*(?:[-.][a-z0-9]+)*?)-(${FAMILY_DEFAULT_LEVELS.join('|')})(-fast)?$`);

/** `claude-opus-5-5-xhigh` or `grok-4.7-xhigh-fast` (poteto-mode "Defaults for every pstack_worker spawn"); undefined for anything else. */
export function parseFamilyDefault(spec: string): FamilyDefault | undefined {
  const match = FAMILY_DEFAULT.exec(spec);
  return match === null ? undefined : { id: match[1]!, level: match[2] as FamilyDefaultLevel, fast: match[3] !== undefined };
}

export const MODEL_SPEC_FORMS = "'inherit-parent', '<provider>/<id>', or a family default '<model>-<level>[-fast]' such as 'claude-opus-5-5-xhigh' or 'grok-4.7-xhigh-fast'; '<provider>/<id>' also accepts a ':<level>' suffix";
