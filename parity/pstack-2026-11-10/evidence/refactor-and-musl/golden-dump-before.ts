import { writeFileSync } from 'node:fs';
import { seccompFilter } from '/Users/josh-desktop/src/personal/pi-customizations/extensions/pi-pstack/src/linux-readonly-sandbox.ts';
for (const arch of ['x64', 'arm64', 'arm', 'ppc64', 's390x']) writeFileSync(`/tmp/golden/${arch}.bpf`, seccompFilter(arch));
writeFileSync('/tmp/golden/s390x-brokered.bpf', seccompFilter('s390x', true));
console.log('captured', 6);
