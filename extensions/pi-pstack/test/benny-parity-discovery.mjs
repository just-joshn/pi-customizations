import { join } from 'node:path';

import { DefaultResourceLoader } from '@earendil-works/pi-coding-agent';

const root = process.argv[2];
const loader = new DefaultResourceLoader({ cwd: root, agentDir: join(root, 'empty-agent-home'), noSkills: true, noPromptTemplates: true, noThemes: true, noContextFiles: true });
await loader.reload();
const { extensions, errors } = loader.getExtensions();
process.stdout.write(JSON.stringify({ extensions: extensions.map((extension) => extension.path), errors }));
