import { join } from 'node:path';

import { DefaultResourceLoader } from '@earendil-works/pi-coding-agent';

const root = process.argv[2];
const loader = new DefaultResourceLoader({ cwd: root, agentDir: join(root, 'empty-agent-home'), noExtensions: true, noPromptTemplates: true, noThemes: true, noContextFiles: true });
await loader.reload();
process.stdout.write(JSON.stringify(loader.getSkills().skills.map((skill) => ({ name: skill.name, filePath: skill.filePath }))));
