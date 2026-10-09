import { randomUUID } from 'node:crypto';
import { unlink } from 'node:fs/promises';
import { join } from 'node:path';

import { parseAutomation } from './automation-domain.mjs';
import { durableRecord, privateDirectory, routineRecord } from './routine-client.mjs';

export async function prepareAutomation(root, input, signal) {
  signal?.throwIfAborted();
  const definition = parseAutomation(input);
  await privateDirectory(root);
  signal?.throwIfAborted();
  const directory = join(root, randomUUID());
  await privateDirectory(directory);
  await durableRecord(join(directory, 'definition.json'), definition);
  signal?.throwIfAborted();
  return { ...definition, directory, kind: 'disabled' };
}

export async function automationDefinition(directory) {
  const stored = await routineRecord(join(directory, 'definition.json'));
  if (!stored) throw new Error('Automation draft is missing.');
  const { revision, ...input } = stored;
  const parsed = parseAutomation(input);
  if (revision !== parsed.revision) throw new Error('Automation revision changed. Prepare a new draft.');
  return parsed;
}

export async function inspectAutomation(directory, signal) {
  signal?.throwIfAborted();
  const definition = await automationDefinition(directory);
  const status = await routineRecord(join(directory, 'status.json'));
  signal?.throwIfAborted();
  if (!status) return { ...definition, directory, kind: 'disabled' };
  return { ...definition, directory, ...status };
}

export async function saveAutomation(directory, input, expectedRevision, signal) {
  signal?.throwIfAborted();
  const current = await automationDefinition(directory);
  if (current.revision !== expectedRevision) throw new Error('Automation revision changed. Inspect and approve the current draft.');
  const definition = parseAutomation(input);
  await privateDirectory(directory);
  signal?.throwIfAborted();
  await durableRecord(join(directory, 'definition.json'), definition);
  signal?.throwIfAborted();
  return { ...definition, directory, kind: 'disabled' };
}

export async function threadSafetyReceipt(directory) {
  return routineRecord(join(directory, 'thread-safety.json'));
}

const SEVEN_CHECK_KEYS = [
  'triageStoresThreadTsAndOneReply',
  'verdictContainsConfiguredMarker',
  'reproAcceptsMarkerFromTriageIdentity',
  'reproKeepsImmutableSourceCoordinates',
  'noSourceChannelRootMessage',
  'delegatedWorkerCannotSlackWrite',
  'missingCoordsOrFailedPreflightProducesNoPost',
];

export async function recordThreadSafety(directory, revision, checks, signal) {
  signal?.throwIfAborted();
  const current = await automationDefinition(directory);
  if (current.revision !== revision) throw new Error('Automation revision changed. Inspect and approve the current draft.');
  if (!checks || typeof checks !== 'object') throw new Error('Thread-safety checks object is required.');
  for (const key of SEVEN_CHECK_KEYS) {
    if (checks[key] !== true) {
      throw new Error(`All seven checks must pass before recording thread-safety (${key}).`);
    }
  }
  const receipt = {
    revision,
    checks: Object.fromEntries(SEVEN_CHECK_KEYS.map((key) => [key, true])),
    recordedAt: new Date().toISOString(),
  };
  await privateDirectory(directory);
  signal?.throwIfAborted();
  await durableRecord(join(directory, 'thread-safety.json'), receipt);
  signal?.throwIfAborted();
  return receipt;
}

export async function enableAutomation(directory, revision, signal) {
  signal?.throwIfAborted();
  const definition = await automationDefinition(directory);
  if (definition.revision !== revision) throw new Error('Automation revision changed. Inspect and approve the current draft.');
  const receipt = await threadSafetyReceipt(directory);
  signal?.throwIfAborted();
  if (!receipt || receipt.revision !== definition.revision) {
    throw new Error('Thread-safety receipt missing or revision mismatch. Creation boundary forbids enable before the seven checks.');
  }
  for (const key of SEVEN_CHECK_KEYS) {
    if (receipt.checks?.[key] !== true) {
      throw new Error(`Thread-safety receipt incomplete (${key}).`);
    }
  }
  const previous = await routineRecord(join(directory, 'status.json'));
  signal?.throwIfAborted();
  if (previous?.kind === 'enabled' && previous.revision === definition.revision) {
    return { ...definition, directory, kind: 'enabled' };
  }
  await privateDirectory(directory);
  signal?.throwIfAborted();
  await durableRecord(join(directory, 'status.json'), {
    kind: 'enabled',
    revision: definition.revision,
    enabledAt: new Date().toISOString(),
  });
  signal?.throwIfAborted();
  return { ...definition, directory, kind: 'enabled' };
}

export async function disableAutomation(directory, signal) {
  signal?.throwIfAborted();
  await automationDefinition(directory);
  const statusPath = join(directory, 'status.json');
  try {
    await unlink(statusPath);
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }
  signal?.throwIfAborted();
  return inspectAutomation(directory, signal);
}
