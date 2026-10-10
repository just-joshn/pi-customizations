import { stringOption } from './spec.ts';

/**
 * The two options that choose where settings come from. Aider files them under "Other
 * settings"; they live with the resolver because every SAR's options depend on them.
 */
export const settingsOptions = {
  config: stringOption({
    name: 'config',
    defaultValue: null,
    help: 'Specify the config file (default: search for .pi-maintainer.conf.yml in git root, cwd or home directory)',
    sar: 'edit',
  }),
  envFile: stringOption({ name: 'env-file', defaultValue: null, help: 'Specify the .env file to load (default: .env in git root)', sar: 'edit' }),
} as const;
