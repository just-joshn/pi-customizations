import { createHash } from 'node:crypto';
import { readdir, readFile, realpath, stat } from 'node:fs/promises';
import { join } from 'node:path';

import { invalidRequest } from '../contract/errors.ts';

export interface AssetCatalogInspection {
  readonly resource_root: {
    readonly caller_path: string;
    readonly canonical_path: string;
  };
  readonly catalogs: readonly {
    readonly path: string;
    readonly bytes: number;
    readonly sha256: string;
    readonly header_magic: string | null;
    readonly header_version: number | null;
  }[];
  readonly renditions: readonly unknown[];
  readonly offset: number;
  readonly next_offset: number | null;
  readonly truncated: boolean;
  readonly limitations: readonly string[];
}

const LIMITATIONS = [
  'Assets.car files are located and digested; rendition metadata is not decoded because pi-rea does not run assetutil or an equivalent CAR decoder.',
  'An empty renditions array means coverage is incomplete, not that the catalog has no assets.',
] as const;

const inputError = (detail: string) =>
  invalidRequest('The inspection input is not usable. Check the argument and retry.', {
    operation: 'inspect_asset_catalog',
    issues: [{ path: [], reason: 'invalid_value', message: detail }],
  });

const walkForCar = async (root: string, budget: { remaining: number }): Promise<string[]> => {
  const found: string[] = [];
  const stack = [root];
  while (stack.length > 0 && budget.remaining > 0) {
    const current = stack.pop()!;
    budget.remaining -= 1;
    let entries;
    try {
      entries = await readdir(current, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const path = join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(path);
        continue;
      }
      if (entry.isFile() && entry.name === 'Assets.car') found.push(path);
    }
  }
  return found;
};

export const inspectAssetCatalogInBundle = async (bundleRoot: string, options: { readonly offset?: number; readonly limit?: number } = {}): Promise<AssetCatalogInspection> => {
  let canonical: string;
  try {
    canonical = await realpath(bundleRoot);
  } catch (error) {
    throw inputError(`Cannot inspect bundle root: ${(error as Error).message}`);
  }
  const stats = await stat(canonical);
  if (!stats.isDirectory()) throw inputError('The open bundle resource root is not a directory.');
  const cars = await walkForCar(canonical, { remaining: 4096 });
  const offset = options.offset ?? 0;
  const limit = options.limit ?? 10_000;
  const pagePaths = cars.slice(offset, offset + limit);
  const catalogs = [];
  for (const path of pagePaths) {
    const bytes = await readFile(path);
    const magic = bytes.length >= 4 ? bytes.subarray(0, 4).toString('latin1') : null;
    const header_version = bytes.length >= 8 ? bytes.readUInt32LE(4) : null;
    catalogs.push({
      path,
      bytes: bytes.length,
      sha256: createHash('sha256').update(bytes).digest('hex'),
      header_magic: magic,
      header_version,
    });
  }
  const next = offset + limit < cars.length ? offset + limit : null;
  return {
    resource_root: { caller_path: bundleRoot, canonical_path: canonical },
    catalogs,
    renditions: [],
    offset,
    next_offset: next,
    truncated: next !== null,
    limitations: [...LIMITATIONS, ...(cars.length === 0 ? ['No Assets.car file was found under the open bundle root.'] : [])],
  };
};
