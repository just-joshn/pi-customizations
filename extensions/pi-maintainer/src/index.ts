import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { installMaintainer } from './core/install.ts';
import { editFeature } from './edit/feature.ts';
import { gitFeature } from './git/feature.ts';
import { mapFeature } from './map/feature.ts';

export default function piMaintainer(pi: ExtensionAPI): void {
  installMaintainer(pi, [editFeature, gitFeature, mapFeature]);
}
