import { ensureGoMachoFixtures, ensureMinimalElfCoreFixture } from '../../../../parity/pi-rea/scripts/lib/ensure-fixtures.mjs';

export default function setup() {
  ensureGoMachoFixtures();
  ensureMinimalElfCoreFixture();
}
