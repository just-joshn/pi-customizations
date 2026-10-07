// Type boundary for upstream's vendored runtime, which tsconfig.vendor.json checks under upstream's own compiler settings.
declare module '#caveman-runtime' {
  import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
  export default function upstreamRuntime(pi: ExtensionAPI): void;
}
