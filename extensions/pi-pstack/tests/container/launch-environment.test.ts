import { expect, test } from 'vitest';
import { launchEnvironment } from '../../src/worker-host.ts';

const source = Object.fromEntries(
  ['PATH', 'SELECTED_API_KEY', 'OTHER_API_KEY', 'PSTACK_CONTAINER_FORGE_TOKEN', 'PSTACK_OTHER_SECRET', 'PSTACK_OPAQUE', 'AWS_SECRET_ACCESS_KEY', 'GOOGLE_APPLICATION_CREDENTIALS', 'SSH_AUTH_SOCK', 'GH_TOKEN'].map((name) => [
    name,
    `sentinel-${name}`,
  ]),
);

test('minimal container snapshots keep only the selected provider credential and explicit forge delivery', () => {
  const snapshot = launchEnvironment('minimal', ['SELECTED_API_KEY'], source, false);
  const delivered: Record<string, string | null | undefined> = { ...snapshot, GH_TOKEN: source['PSTACK_CONTAINER_FORGE_TOKEN'] };
  expect(
    Object.keys(delivered)
      .filter((name) => delivered[name] !== null)
      .sort(),
  ).toEqual(['GH_TOKEN', 'PATH', 'SELECTED_API_KEY']);
  expect(delivered['SELECTED_API_KEY'] === source['SELECTED_API_KEY']).toBe(true);
  expect(delivered['GH_TOKEN'] === source['PSTACK_CONTAINER_FORGE_TOKEN']).toBe(true);
});

test('local minimal workers retain their documented PSTACK environment', () => {
  const snapshot = launchEnvironment('minimal', ['SELECTED_API_KEY'], source);
  expect(snapshot['PSTACK_OPAQUE'] === source['PSTACK_OPAQUE']).toBe(true);
});

test('explicit inheritance still passes the host snapshot to a container', () => {
  expect(Object.keys(launchEnvironment('inherit', [], source, false)).sort()).toEqual(Object.keys(source).sort());
});
