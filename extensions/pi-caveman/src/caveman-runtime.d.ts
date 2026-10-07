// Type boundary for upstream's vendored runtime. Its own tsconfig checks it under upstream's compiler settings.
import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';

export default function upstreamRuntime(pi: ExtensionAPI): void;
