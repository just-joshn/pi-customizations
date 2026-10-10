import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { installMaintainer } from './core/install.ts';
import { editFeature } from './edit/feature.ts';

export default function piMaintainer(pi: ExtensionAPI): void {
  installMaintainer(pi, [editFeature]);
}
