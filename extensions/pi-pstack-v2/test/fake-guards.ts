import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';

/** Whether every named member of the fake is a function, so a fake that lacks one a test relies on fails loudly. */
export const hasMethods = (fake: object, names: readonly string[]): boolean => names.every((name) => typeof Reflect.get(fake, name) === 'function');

const EXTENSION_API_METHODS = ['on', 'registerTool'] as const;

const isExtensionApi = (fake: object): fake is ExtensionAPI => hasMethods(fake, EXTENSION_API_METHODS);

/** Gives a recording fake of Pi's extension API to an extension, after checking it carries what the extension registers with. */
export function extensionApiFrom(fake: object): ExtensionAPI {
  if (!isExtensionApi(fake)) throw new Error(`The fake Pi API lacks one of ${EXTENSION_API_METHODS.join(', ')}.`);
  return fake;
}
