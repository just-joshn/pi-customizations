// Generated from @google/genai 2.21.0 by scripts/vendor-pi-ai.mjs. Do not edit.
// Stand-ins for the @google/genai values and types the vendored Google modules use.
export const FinishReason = {
  FINISH_REASON_UNSPECIFIED: 'FINISH_REASON_UNSPECIFIED',
  STOP: 'STOP',
  MAX_TOKENS: 'MAX_TOKENS',
  SAFETY: 'SAFETY',
  RECITATION: 'RECITATION',
  LANGUAGE: 'LANGUAGE',
  OTHER: 'OTHER',
  BLOCKLIST: 'BLOCKLIST',
  PROHIBITED_CONTENT: 'PROHIBITED_CONTENT',
  SPII: 'SPII',
  MALFORMED_FUNCTION_CALL: 'MALFORMED_FUNCTION_CALL',
  IMAGE_SAFETY: 'IMAGE_SAFETY',
  UNEXPECTED_TOOL_CALL: 'UNEXPECTED_TOOL_CALL',
  TOO_MANY_TOOL_CALLS: 'TOO_MANY_TOOL_CALLS',
  IMAGE_PROHIBITED_CONTENT: 'IMAGE_PROHIBITED_CONTENT',
  NO_IMAGE: 'NO_IMAGE',
  IMAGE_RECITATION: 'IMAGE_RECITATION',
  IMAGE_OTHER: 'IMAGE_OTHER',
} as const;
export type FinishReason = (typeof FinishReason)[keyof typeof FinishReason];

export const FunctionCallingConfigMode = {
  MODE_UNSPECIFIED: 'MODE_UNSPECIFIED',
  AUTO: 'AUTO',
  ANY: 'ANY',
  NONE: 'NONE',
  VALIDATED: 'VALIDATED',
} as const;
export type FunctionCallingConfigMode = (typeof FunctionCallingConfigMode)[keyof typeof FunctionCallingConfigMode];

export const ThinkingLevel = {
  THINKING_LEVEL_UNSPECIFIED: 'THINKING_LEVEL_UNSPECIFIED',
  MINIMAL: 'MINIMAL',
  LOW: 'LOW',
  MEDIUM: 'MEDIUM',
  HIGH: 'HIGH',
} as const;
export type ThinkingLevel = (typeof ThinkingLevel)[keyof typeof ThinkingLevel];

export interface Part {
  text?: string;
  thought?: boolean;
  thoughtSignature?: string;
  inlineData?: { mimeType?: string; data?: string };
  functionCall?: { id?: string; name?: string; args?: Record<string, unknown> };
  functionResponse?: { id?: string; name?: string; response?: Record<string, unknown>; parts?: Part[] };
}

export interface Content {
  role?: string;
  parts?: Part[];
}

export interface ThinkingConfig {
  includeThoughts?: boolean;
  thinkingBudget?: number;
  thinkingLevel?: ThinkingLevel;
}
