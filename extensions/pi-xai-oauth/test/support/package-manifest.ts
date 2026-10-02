export function declaredExtensions(manifest: unknown): readonly string[] {
  if (typeof manifest !== 'object' || manifest === null || !('pi' in manifest)) return [];
  const { pi } = manifest;
  if (typeof pi !== 'object' || pi === null || !('extensions' in pi) || !Array.isArray(pi.extensions)) return [];
  return pi.extensions.filter((entry) => typeof entry === 'string');
}
