import { createHash } from 'node:crypto';
import { readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const digest = (value) => createHash('sha256').update(value).digest('hex');

export function prepareDoctorGuard({ doctor, directory, phase, groups, readonly = false }) {
  const sdk = realpathSync(join(dirname(dirname(realpathSync(doctor.imagePath))), 'install/releases/1.1.0/node_modules/@earendil-works/pi-coding-agent/dist/index.js'));
  const runtime = fileURLToPath(new URL('./resource-workflows-doctor-native-boundary.mjs', import.meta.url));
  const policy = JSON.stringify({ cwd: doctor.cwd, phase, groups });
  const channel = fileURLToPath(new URL('./resource-workflows-doctor-readonly-channel.mjs', import.meta.url));
  const content = `import { registerDoctorNativeBoundary } from ${JSON.stringify(pathToFileURL(runtime).href)};\n${readonly ? `import { createDoctorReadonlyClient } from ${JSON.stringify(pathToFileURL(channel).href)};\n` : ''}export default pi => registerDoctorNativeBoundary(pi, ${readonly ? `{...${policy}, readonly: createDoctorReadonlyClient()}` : policy}, ${JSON.stringify(pathToFileURL(sdk).href)});\n`;
  const path = join(directory, 'doctor-native-boundary.mjs');
  writeFileSync(path, content, { flag: 'wx', mode: 0o400 });
  return {
    path,
    sha256: digest(content),
    runtime: { path: runtime, sha256: digest(readFileSync(runtime)) },
    sdk: { path: sdk, sha256: digest(readFileSync(sdk)) },
    dependencies: [fileURLToPath(new URL('./resource-workflows-doctor-readonly.mjs', import.meta.url)), ...(readonly ? [channel] : [])].map((path) => ({ path, sha256: digest(readFileSync(path)) })),
    contract: `native-read-or-exact-approved-native-write-and-sdk-edit${readonly ? '-and-authenticated-fixed-readonly' : ''}`,
    editVariants: true,
  };
}
