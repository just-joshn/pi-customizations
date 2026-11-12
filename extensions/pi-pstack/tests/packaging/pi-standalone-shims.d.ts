declare module '../../scripts/pi-standalone-shims.mjs' {
  export function findEnvKeys(provider: string, env?: Record<string, string | undefined>): string[] | undefined;
}
