import { createHash, X509Certificate } from 'node:crypto';
import { readFile, realpath } from 'node:fs/promises';
import { isAbsolute, resolve } from 'node:path';

import { invalidRequest } from '../contract/errors.ts';
import { findEndOfCentralDirectory, readZipDirectory, readZipMember } from './formats/zip.mjs';

export const APK_SIG_MAGIC = Buffer.from('APK Sig Block 42');
export const APK_SIG_V2 = 0x7109871a;
export const APK_SIG_V3 = 0xf05368c0;
export const APK_SIG_V31 = 0x1b93ad61;
export const APK_SIG_SOURCE_STAMP_V2 = 0x6dff800d;

const MAX_FILE_BYTES = 64 * 1024 * 1024;
const MAX_SIGNERS = 32;

export interface ApkCertificate {
  readonly der_sha256: string;
  readonly subject: string | null;
  readonly issuer: string | null;
  readonly serial_hex: string | null;
  readonly not_before: string | null;
  readonly not_after: string | null;
}

export interface ApkBlockSigner {
  readonly index: number;
  readonly certificates: readonly ApkCertificate[];
  readonly digest_algorithms: readonly string[];
  readonly min_sdk: number | null;
  readonly max_sdk: number | null;
  readonly decode_error: string | null;
}

export interface ApkSignatureInspection {
  readonly artifact: { readonly path: string; readonly sha256: string; readonly bytes: number };
  readonly schemes: {
    readonly v1: {
      readonly present: boolean;
      readonly has_manifest: boolean;
      readonly signature_files: readonly string[];
      readonly block_files: readonly string[];
      readonly signers: readonly {
        readonly signature_file: string;
        readonly block_file: string;
        readonly certificate: ApkCertificate | null;
        readonly certificates: readonly ApkCertificate[];
        readonly signer_infos: readonly unknown[];
        readonly decode_error: string | null;
      }[];
    };
    readonly v2: { readonly present: boolean; readonly signers: readonly ApkBlockSigner[]; readonly uninterpreted_bytes: number };
    readonly v3: { readonly present: boolean; readonly signers: readonly ApkBlockSigner[]; readonly uninterpreted_bytes: number };
    readonly 'v3.1': { readonly present: boolean; readonly signers: readonly ApkBlockSigner[]; readonly uninterpreted_bytes: number };
  };
  readonly source_stamp: { readonly present: boolean; readonly certificate: ApkCertificate | null; readonly decode_error: string | null };
  readonly posture: {
    readonly v1_only: boolean;
    readonly schemes_agree_on_signer: boolean | null;
    readonly signer_change_declared_by_rotation: boolean | null;
    readonly v1_signers_match_block_signers: boolean | null;
    readonly rotation_present: boolean;
    readonly source_stamp_present: boolean;
    readonly strongest_scheme: 'none' | 'v1' | 'v2' | 'v3' | 'v3.1';
    readonly self_consistent: boolean | null;
  };
  readonly runtime_execution: 'not-performed';
  readonly limitations: readonly string[];
}

const LIMITATIONS = [
  'Static structural inspection only. No Android code executes, no device or adb is involved, and odex/vdex/oat/cdex are not read.',
  'No signature is verified: signer, rotation-lineage and source-stamp signatures are NOT cryptographically checked, and certificate chains, revocation and authenticity are NOT evaluated. Certificates and lineages are what the APK declares.',
  'matches_apk and self_consistent only show that the declared content digest equals the digest of the current bytes. This is not a signature verification: anyone who changes the bytes can recompute the digest and write it into the signed data. SHA-256 identifies the exact bytes, not the producer.',
  "v1 signers are what each signature block's PKCS#7 SignedData declares: its signatures, the .SF and MANIFEST.MF digests and entry coverage are NOT verified.",
  'Not read: v4 .apk.idsig, verity digests (matches_apk null), and the v1 X-Android-APK-Signed marker, so v1_only cannot distinguish a v1-only APK from one whose v2/v3 block was removed.',
] as const;

const pkcs7ContentTypeError = (bytes: Buffer): string | null => {
  // ContentInfo ::= SEQUENCE { contentType OBJECT IDENTIFIER, ... }
  if (bytes.length < 4 || bytes[0] !== 0x30) return null;
  let cursor = 1;
  const first = bytes[cursor];
  if (first === undefined) return null;
  cursor += 1;
  if ((first & 0x80) === 0) {
    // short form length; contentType follows
  } else {
    const count = first & 0x7f;
    if (count === 0 || count > 4 || cursor + count > bytes.length) return null;
    cursor += count;
  }
  const tag = bytes[cursor];
  if (tag === undefined) return null;
  if (tag === 0x06) return null;
  return `malformed PKCS#7: contentType has tag 0x${tag.toString(16)}, expected 0x6`;
};

const inputError = (path: string, detail: string) =>
  invalidRequest('The inspection input is not usable. Check the argument and retry.', {
    operation: 'inspect_apk_signature',
    issues: [{ path: ['path'], reason: 'invalid_value', message: `Cannot inspect ${path}: ${detail}` }],
  });

const certFromDer = (der: Buffer): ApkCertificate => {
  const der_sha256 = createHash('sha256').update(der).digest('hex');
  try {
    const cert = new X509Certificate(der);
    return {
      der_sha256,
      subject: cert.subject || null,
      issuer: cert.issuer || null,
      serial_hex: cert.serialNumber?.toLowerCase() ?? null,
      not_before: new Date(cert.validFrom).toISOString(),
      not_after: new Date(cert.validTo).toISOString(),
    };
  } catch {
    return { der_sha256, subject: null, issuer: null, serial_hex: null, not_before: null, not_after: null };
  }
};

const findApkSigningBlock = (bytes: Buffer, directoryOffset: number): { readonly start: number; readonly pairs: Buffer } | null => {
  if (directoryOffset < 24) return null;
  const magicStart = directoryOffset - 16;
  if (!bytes.subarray(magicStart, directoryOffset).equals(APK_SIG_MAGIC)) return null;
  const blockSizeHigh = Number(bytes.readBigUInt64LE(directoryOffset - 24));
  if (blockSizeHigh < 24 || blockSizeHigh > directoryOffset) return null;
  const start = directoryOffset - Number(blockSizeHigh) - 8;
  if (start < 0) return null;
  const sizeLow = Number(bytes.readBigUInt64LE(start));
  if (sizeLow !== blockSizeHigh) return null;
  const pairs = bytes.subarray(start + 8, directoryOffset - 24);
  return { start, pairs };
};

const readLengthPrefixed = (bytes: Buffer, offset: number): { readonly value: Buffer; readonly next: number } | null => {
  if (offset + 4 > bytes.length) return null;
  const length = bytes.readUInt32LE(offset);
  const start = offset + 4;
  const end = start + length;
  if (end > bytes.length || length < 0) return null;
  return { value: bytes.subarray(start, end), next: end };
};

const extractCertificatesFromSigner = (signer: Buffer): { readonly certificates: ApkCertificate[]; readonly digests: string[]; readonly minSdk: number | null; readonly maxSdk: number | null; readonly error: string | null } => {
  // signer := length-prefixed signed-data || length-prefixed signatures || length-prefixed public-key
  const signed = readLengthPrefixed(signer, 0);
  if (signed === null) return { certificates: [], digests: [], minSdk: null, maxSdk: null, error: 'truncated signer' };
  // signed-data := digests || certificates || [minSdk maxSdk] || additional attributes
  const digestsBlock = readLengthPrefixed(signed.value, 0);
  if (digestsBlock === null) return { certificates: [], digests: [], minSdk: null, maxSdk: null, error: 'truncated signed-data digests' };
  const certsBlock = readLengthPrefixed(signed.value, digestsBlock.next);
  if (certsBlock === null) return { certificates: [], digests: [], minSdk: null, maxSdk: null, error: 'truncated signed-data certificates' };
  const certificates: ApkCertificate[] = [];
  let cursor = 0;
  while (cursor + 4 <= certsBlock.value.length && certificates.length < MAX_SIGNERS) {
    const one = readLengthPrefixed(certsBlock.value, cursor);
    if (one === null) break;
    certificates.push(certFromDer(Buffer.from(one.value)));
    cursor = one.next;
  }
  const digests: string[] = [];
  cursor = 0;
  while (cursor + 8 <= digestsBlock.value.length) {
    const one = readLengthPrefixed(digestsBlock.value, cursor);
    if (one === null || one.value.length < 4) break;
    digests.push(`0x${one.value.readUInt32LE(0).toString(16)}`);
    cursor = one.next;
  }
  let minSdk: number | null = null;
  let maxSdk: number | null = null;
  if (certsBlock.next + 8 <= signed.value.length) {
    minSdk = signed.value.readUInt32LE(certsBlock.next);
    maxSdk = signed.value.readUInt32LE(certsBlock.next + 4);
  }
  return { certificates, digests, minSdk, maxSdk, error: null };
};

const parseSchemeSigners = (pairs: Buffer, id: number): { readonly present: boolean; readonly signers: ApkBlockSigner[]; readonly uninterpreted_bytes: number } => {
  let cursor = 0;
  let uninterpreted = 0;
  while (cursor + 12 <= pairs.length) {
    const pairLen = Number(pairs.readBigUInt64LE(cursor));
    const pairId = pairs.readUInt32LE(cursor + 8);
    const valueStart = cursor + 12;
    const valueEnd = cursor + 8 + pairLen;
    if (pairLen < 4 || valueEnd > pairs.length) {
      uninterpreted += Math.max(0, pairs.length - cursor);
      break;
    }
    if (pairId === id) {
      const value = pairs.subarray(valueStart, valueEnd);
      const signersBlock = readLengthPrefixed(value, 0);
      if (signersBlock === null) return { present: true, signers: [], uninterpreted_bytes: value.length };
      const signers: ApkBlockSigner[] = [];
      let sc = 0;
      let index = 0;
      while (sc + 4 <= signersBlock.value.length && signers.length < MAX_SIGNERS) {
        const one = readLengthPrefixed(signersBlock.value, sc);
        if (one === null) break;
        const decoded = extractCertificatesFromSigner(one.value);
        signers.push({
          index,
          certificates: decoded.certificates,
          digest_algorithms: decoded.digests,
          min_sdk: decoded.minSdk,
          max_sdk: decoded.maxSdk,
          decode_error: decoded.error,
        });
        index += 1;
        sc = one.next;
      }
      uninterpreted += Math.max(0, signersBlock.value.length - sc);
      return { present: true, signers, uninterpreted_bytes: uninterpreted };
    }
    cursor = valueEnd;
  }
  return { present: false, signers: [], uninterpreted_bytes: 0 };
};

const parseSourceStamp = (pairs: Buffer): { readonly present: boolean; readonly certificate: ApkCertificate | null; readonly decode_error: string | null } => {
  let cursor = 0;
  while (cursor + 12 <= pairs.length) {
    const pairLen = Number(pairs.readBigUInt64LE(cursor));
    const pairId = pairs.readUInt32LE(cursor + 8);
    const valueStart = cursor + 12;
    const valueEnd = cursor + 8 + pairLen;
    if (pairLen < 4 || valueEnd > pairs.length) break;
    if (pairId === APK_SIG_SOURCE_STAMP_V2) {
      const value = pairs.subarray(valueStart, valueEnd);
      const cert = readLengthPrefixed(value, 0);
      if (cert === null) return { present: true, certificate: null, decode_error: 'truncated source stamp certificate' };
      return { present: true, certificate: certFromDer(Buffer.from(cert.value)), decode_error: null };
    }
    cursor = valueEnd;
  }
  return { present: false, certificate: null, decode_error: null };
};

const collectV1 = (bytes: Buffer): ApkSignatureInspection['schemes']['v1'] => {
  const directory = readZipDirectory(bytes);
  const signature_files: string[] = [];
  const block_files: string[] = [];
  let has_manifest = false;
  for (const entry of directory.entries) {
    const name = entry.logical_path;
    if (name === 'META-INF/MANIFEST.MF') has_manifest = true;
    if (/^META-INF\/.+\.SF$/u.test(name)) signature_files.push(name);
    if (/^META-INF\/.+\.(RSA|DSA|EC)$/u.test(name)) block_files.push(name);
  }
  const signers: ApkSignatureInspection['schemes']['v1']['signers'][number][] = [];
  for (const blockPath of block_files) {
    const base = blockPath.replace(/\.(RSA|DSA|EC)$/u, '');
    const sfPath = `${base}.SF`;
    if (!signature_files.includes(sfPath)) continue;
    const entry = directory.entries.find((candidate) => candidate.logical_path === blockPath);
    if (entry === undefined) continue;
    try {
      const member = readZipMember(bytes, entry);
      const certificates: ApkCertificate[] = [];
      const collectDerCerts = (buf: Buffer, depth: number): void => {
        if (depth > 6 || certificates.length >= MAX_SIGNERS) return;
        let offset = 0;
        while (offset + 4 < buf.length && certificates.length < MAX_SIGNERS) {
          if (buf[offset] !== 0x30) {
            offset += 1;
            continue;
          }
          try {
            let cursor = offset + 1;
            const first = buf[cursor];
            if (first === undefined) {
              offset += 1;
              continue;
            }
            cursor += 1;
            let length = 0;
            if ((first & 0x80) === 0) length = first;
            else {
              const count = first & 0x7f;
              if (count === 0 || count > 4 || cursor + count > buf.length) {
                offset += 1;
                continue;
              }
              for (let i = 0; i < count; i += 1) {
                const byte = buf[cursor + i];
                if (byte === undefined) break;
                length = (length << 8) | byte;
              }
              cursor += count;
            }
            const end = cursor + length;
            if (end > buf.length) {
              offset += 1;
              continue;
            }
            const slice = buf.subarray(offset, end);
            try {
              const parsed = new X509Certificate(slice);
              void parsed;
              certificates.push(certFromDer(Buffer.from(slice)));
              offset = end;
            } catch {
              collectDerCerts(buf.subarray(cursor, end), depth + 1);
              offset = end;
            }
          } catch {
            offset += 1;
          }
        }
      };
      collectDerCerts(member.bytes, 0);
      const contentTypeError = certificates.length === 0 ? pkcs7ContentTypeError(member.bytes) : null;
      signers.push({
        signature_file: sfPath,
        block_file: blockPath,
        certificate: certificates[0] ?? null,
        certificates,
        signer_infos: [],
        decode_error: certificates.length === 0 ? (contentTypeError ?? 'no X.509 certificates decoded from the PKCS#7 block') : null,
      });
    } catch (error) {
      signers.push({
        signature_file: sfPath,
        block_file: blockPath,
        certificate: null,
        certificates: [],
        signer_infos: [],
        decode_error: (error as Error).message,
      });
    }
  }
  return {
    present: signers.length > 0,
    has_manifest,
    signature_files,
    block_files,
    signers,
  };
};

const strongest = (schemes: ApkSignatureInspection['schemes']): ApkSignatureInspection['posture']['strongest_scheme'] => {
  if (schemes['v3.1'].present) return 'v3.1';
  if (schemes.v3.present) return 'v3';
  if (schemes.v2.present) return 'v2';
  if (schemes.v1.present) return 'v1';
  return 'none';
};

const signerSet = (signers: readonly { readonly certificates: readonly ApkCertificate[] }[]): Set<string> | null => {
  const digests = new Set<string>();
  for (const signer of signers) {
    if (signer.certificates.length === 0) return null;
    for (const cert of signer.certificates) digests.add(cert.der_sha256);
  }
  return digests;
};

export const inspectApkSignatureFromPath = async (path: string, options: { readonly cwd?: string } = {}): Promise<{ readonly record: ApkSignatureInspection; readonly path: string; readonly resolvedPath: string }> => {
  const resolvedPath = isAbsolute(path) ? path : resolve(options.cwd ?? process.cwd(), path);
  let canonical = resolvedPath;
  try {
    canonical = await realpath(resolvedPath);
  } catch {}
  let bytes: Buffer;
  try {
    bytes = await readFile(canonical);
  } catch (error) {
    throw inputError(path, `it could not be read (${(error as Error).message})`);
  }
  if (bytes.length > MAX_FILE_BYTES) throw inputError(path, `the archive is ${bytes.length} bytes, more than the ${MAX_FILE_BYTES} byte limit`);
  const eocd = findEndOfCentralDirectory(bytes);
  if (eocd < 0) throw inputError(path, 'no ZIP end-of-central-directory record was found');
  let directoryOffset = bytes.readUInt32LE(eocd + 16);
  if (directoryOffset === 0xffffffff) {
    const locator = eocd - 20;
    if (locator >= 0 && bytes.readUInt32LE(locator) === 0x07064b50) {
      const recordOffset = Number(bytes.readBigUInt64LE(locator + 8));
      if (recordOffset + 56 <= bytes.length) directoryOffset = Number(bytes.readBigUInt64LE(recordOffset + 48));
    }
  }
  const v1 = collectV1(bytes);
  const block = findApkSigningBlock(bytes, directoryOffset);
  const pairs = block?.pairs ?? Buffer.alloc(0);
  const v2 = parseSchemeSigners(pairs, APK_SIG_V2);
  const v3 = parseSchemeSigners(pairs, APK_SIG_V3);
  const v31 = parseSchemeSigners(pairs, APK_SIG_V31);
  const source_stamp = parseSourceStamp(pairs);
  const schemes = { v1, v2, v3, 'v3.1': v31 };
  const blockSets = [v2, v3, v31].filter((scheme) => scheme.present).map((scheme) => signerSet(scheme.signers));
  let schemes_agree_on_signer: boolean | null = null;
  if (blockSets.length > 0) {
    if (blockSets.some((set) => set === null)) schemes_agree_on_signer = null;
    else {
      const [firstSet, ...rest] = blockSets as Set<string>[];
      schemes_agree_on_signer = firstSet !== undefined && rest.every((set) => set.size === firstSet.size && [...set].every((digest) => firstSet.has(digest)));
    }
  }
  const record: ApkSignatureInspection = {
    artifact: {
      path: canonical,
      sha256: createHash('sha256').update(bytes).digest('hex'),
      bytes: bytes.length,
    },
    schemes,
    source_stamp,
    posture: {
      v1_only: v1.present && !v2.present && !v3.present && !v31.present,
      schemes_agree_on_signer,
      signer_change_declared_by_rotation: false,
      v1_signers_match_block_signers: null,
      rotation_present: false,
      source_stamp_present: source_stamp.present,
      strongest_scheme: strongest(schemes),
      self_consistent: null,
    },
    runtime_execution: 'not-performed',
    limitations: [...LIMITATIONS],
  };
  return { record, path, resolvedPath: canonical };
};
