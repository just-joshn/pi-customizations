import { createHash, X509Certificate } from 'node:crypto';

import { type DerNode, derChildren, derIntegerHex, derOid, derUtf8, readDerNode } from './asn1.ts';
import { DIR, type PeFileLocation, type PeImage, parsePeImage, peInputError, resolvePathBytes } from './pe-core.ts';

const at = <T>(values: readonly T[], index: number): T => {
  const value = values[index];
  if (value === undefined) throw new Error(`missing DER child at index ${index}`);
  return value;
};

export const DEFAULT_MAX_ENTRIES = 8;

export interface PeCertificatesInspection {
  readonly artifact: { readonly path: string; readonly sha256: string; readonly bytes: number };
  readonly format: 'pe32' | 'pe32-plus';
  readonly machine: number;
  readonly table: { readonly location: PeFileLocation; readonly data_directory_location: PeFileLocation } | null;
  readonly entries: readonly PeCertificateEntry[];
  readonly coverage: { readonly status: string; readonly examined_entries: number; readonly certificates: number };
  readonly limitations: readonly string[];
}

export interface PeCertificateEntry {
  readonly index: number;
  readonly location: PeFileLocation;
  readonly length: number;
  readonly revision: number;
  readonly certificate_type: number;
  readonly certificate_type_name: 'x509' | 'pkcs7' | 'reserved' | 'ts_stack_signed' | 'unknown';
  readonly payload: { readonly location: PeFileLocation; readonly bytes: number; readonly sha256: string };
  readonly pkcs7: PePkcs7 | null;
}

interface NameInfo {
  readonly text: string;
  readonly attributes: readonly { readonly oid: string; readonly oid_name: string | null; readonly value: string }[];
}

interface PePkcs7 {
  readonly content_type_oid: string;
  readonly content_type_name: string | null;
  readonly digest_algorithm_oids: readonly string[];
  readonly certificates: readonly {
    readonly location: PeFileLocation;
    readonly der_sha256: string;
    readonly serial_hex: string;
    readonly issuer: NameInfo;
    readonly subject: NameInfo;
    readonly not_before: string;
    readonly not_after: string;
    readonly signature_algorithm_oid: string;
    readonly signature_algorithm_name: string | null;
  }[];
  readonly signers: readonly {
    readonly digest_algorithm_oid: string;
    readonly digest_algorithm_name: string | null;
    readonly signature_algorithm_oid: string;
    readonly signature_algorithm_name: string | null;
    readonly issuer: NameInfo | null;
    readonly serial_hex: string | null;
    readonly subject_key_identifier_hex: string | null;
    readonly authenticated_attributes: boolean;
  }[];
}

export const PE_CERT_LIMITATIONS = [
  'This workflow does not verify signatures, certificate chains, timestamps, or Authenticode digest coverage of image bytes.',
  'PKCS#7 fields are decoded structurally; cryptographic validity remains unobserved.',
];

const OID_NAMES: Record<string, string> = {
  '1.2.840.113549.1.7.2': 'signedData',
  '1.2.840.113549.1.7.1': 'data',
  '1.2.840.113549.1.9.16.1.4': 'timestampToken',
  '1.2.840.113549.1.1.1': 'rsaEncryption',
  '1.2.840.113549.1.1.11': 'sha256WithRSAEncryption',
  '1.2.840.113549.1.1.5': 'sha1WithRSAEncryption',
  '2.16.840.1.101.3.4.2.1': 'sha256',
  '1.3.14.3.2.26': 'sha1',
  '2.5.4.3': 'commonName',
  '2.5.4.6': 'countryName',
  '2.5.4.10': 'organizationName',
  '2.5.4.11': 'organizationalUnitName',
};

const typeName = (type: number): PeCertificateEntry['certificate_type_name'] => {
  if (type === 1) return 'x509';
  if (type === 2) return 'pkcs7';
  if (type === 3) return 'reserved';
  if (type === 4) return 'ts_stack_signed';
  return 'unknown';
};

const align8 = (value: number): number => (value + 7) & ~7;

const parseNameDer = (bytes: Buffer, node: DerNode): NameInfo => {
  const attributes: NameInfo['attributes'][number][] = [];
  for (const rdn of derChildren(bytes, node)) {
    for (const atv of derChildren(bytes, rdn)) {
      const kids = derChildren(bytes, atv);
      const oidNode = kids[0];
      const valueNode = kids[1];
      if (oidNode === undefined || valueNode === undefined) continue;
      const oid = derOid(bytes, oidNode);
      attributes.push({ oid, oid_name: OID_NAMES[oid] ?? null, value: derUtf8(bytes, valueNode) });
    }
  }
  return {
    attributes,
    text: attributes.map((entry) => `${entry.oid_name ?? entry.oid}=${entry.value}`).join(', '),
  };
};

const derTimeText = (bytes: Buffer, node: DerNode): string => bytes.subarray(node.contentOffset, node.end).toString('ascii');

const parseX509Fields = (payload: Buffer, certNode: DerNode) => {
  const [tbs, signatureAlgorithm] = derChildren(payload, certNode);
  if (tbs === undefined || signatureAlgorithm === undefined) throw new Error('X.509 certificate is truncated');
  const tbsChildren = derChildren(payload, tbs);
  let index = 0;
  if (tbsChildren[0]?.tag === 0xa0) index = 1;
  const serialNode = tbsChildren[index++];
  index += 1;
  const issuerNode = tbsChildren[index++];
  const validityNode = tbsChildren[index++];
  const subjectNode = tbsChildren[index++];
  if (serialNode === undefined || issuerNode === undefined || validityNode === undefined || subjectNode === undefined) {
    throw new Error('X.509 TBSCertificate is truncated');
  }
  const [notBefore, notAfter] = derChildren(payload, validityNode);
  if (notBefore === undefined || notAfter === undefined) throw new Error('X.509 Validity is truncated');
  const [sigOidNode] = derChildren(payload, signatureAlgorithm);
  const signatureOid = sigOidNode === undefined ? '' : derOid(payload, sigOidNode);
  const serialHex = derIntegerHex(payload, serialNode).replace(/^00/, '').replace(/^0+/, '') || '0';
  return {
    serial_hex: serialHex,
    issuer: parseNameDer(payload, issuerNode),
    subject: parseNameDer(payload, subjectNode),
    not_before: derTimeText(payload, notBefore),
    not_after: derTimeText(payload, notAfter),
    signature_algorithm_oid: signatureOid,
    signature_algorithm_name: OID_NAMES[signatureOid] ?? null,
  };
};

const parsePkcs7 = (payload: Buffer, baseOffset: number): PePkcs7 => {
  const root = readDerNode(payload, 0);
  if (root.tag !== 0x30) throw new Error('PKCS#7 ContentInfo must be a SEQUENCE');
  const [contentTypeNode, contentNode] = derChildren(payload, root);
  if (contentTypeNode === undefined || contentNode === undefined) throw new Error('PKCS#7 ContentInfo is truncated');
  const contentTypeOid = derOid(payload, contentTypeNode);
  if (contentTypeOid !== '1.2.840.113549.1.7.2') throw new Error('PKCS#7 content type is not signedData');
  if ((contentNode.tag & 0xa0) !== 0xa0) throw new Error('PKCS#7 signedData content is not [0] EXPLICIT');
  const signedData = readDerNode(payload, contentNode.contentOffset);
  const signedChildren = derChildren(payload, signedData);
  if (signedChildren.length < 4) throw new Error('PKCS#7 signedData lacks required fields');

  const digestAlgs = derChildren(payload, at(signedChildren, 1))
    .map((alg) => {
      const [oidNode] = derChildren(payload, alg);
      return oidNode === undefined ? '' : derOid(payload, oidNode);
    })
    .filter(Boolean);

  const certificates: {
    location: PeFileLocation;
    der_sha256: string;
    serial_hex: string;
    issuer: NameInfo;
    subject: NameInfo;
    not_before: string;
    not_after: string;
    signature_algorithm_oid: string;
    signature_algorithm_name: string | null;
  }[] = [];
  const signers: {
    digest_algorithm_oid: string;
    digest_algorithm_name: string | null;
    signature_algorithm_oid: string;
    signature_algorithm_name: string | null;
    issuer: NameInfo | null;
    serial_hex: string | null;
    subject_key_identifier_hex: string | null;
    authenticated_attributes: boolean;
  }[] = [];

  for (const child of signedChildren) {
    if (child.tag === 0xa0) {
      let cursor = child.contentOffset;
      while (cursor < child.end) {
        const certNode = readDerNode(payload, cursor);
        const der = payload.subarray(certNode.offset, certNode.end);
        void new X509Certificate(der);
        const fields = parseX509Fields(payload, certNode);
        certificates.push({
          location: { offset: baseOffset + certNode.offset, bytes: der.length },
          der_sha256: createHash('sha256').update(der).digest('hex'),
          ...fields,
        });
        cursor = certNode.end;
      }
    }
  }

  const signerInfos = at(signedChildren, signedChildren.length - 1);
  for (const signer of derChildren(payload, signerInfos)) {
    const fields = derChildren(payload, signer);
    if (fields.length < 4) continue;
    const versionOk = fields[0];
    void versionOk;
    const issuerAndSerialNode = at(fields, 1);
    const digestAlgNode = at(fields, 2);
    const issuerAndSerial = derChildren(payload, issuerAndSerialNode);
    let issuer: NameInfo | null = null;
    let serialHex: string | null = null;
    let ski: string | null = null;
    if (issuerAndSerial.length >= 2 && issuerAndSerialNode.tag === 0x30) {
      serialHex = derIntegerHex(payload, at(issuerAndSerial, 1));
      issuer = parseNameDer(payload, at(issuerAndSerial, 0));
    } else if ((issuerAndSerialNode.tag & 0xa0) === 0xa0) {
      const skiNode = readDerNode(payload, issuerAndSerialNode.contentOffset);
      ski = payload.subarray(skiNode.contentOffset, skiNode.end).toString('hex');
    }
    const digestAlg = derChildren(payload, digestAlgNode);
    const digestOid = digestAlg[0] === undefined ? '' : derOid(payload, digestAlg[0]);
    let cursor = 3;
    let authenticated = false;
    const authenticatedField = fields[cursor];
    if (authenticatedField !== undefined && (authenticatedField.tag & 0xa0) === 0xa0) {
      authenticated = true;
      cursor += 1;
    }
    const signatureAlgNode = fields[cursor];
    const signatureAlg = signatureAlgNode === undefined ? [] : derChildren(payload, signatureAlgNode);
    const signatureOid = signatureAlg[0] === undefined ? '' : derOid(payload, signatureAlg[0]);
    signers.push({
      digest_algorithm_oid: digestOid,
      digest_algorithm_name: OID_NAMES[digestOid] ?? null,
      signature_algorithm_oid: signatureOid,
      signature_algorithm_name: OID_NAMES[signatureOid] ?? null,
      issuer,
      serial_hex: serialHex,
      subject_key_identifier_hex: ski,
      authenticated_attributes: authenticated,
    });
  }

  void derUtf8;
  return {
    content_type_oid: contentTypeOid,
    content_type_name: OID_NAMES[contentTypeOid] ?? null,
    digest_algorithm_oids: digestAlgs,
    certificates,
    signers,
  };
};

export interface PeCertificatesOptions {
  readonly maxFileBytes?: number;
  readonly maxEntries?: number;
  readonly cwd?: string;
}

export const inspectPeCertificatesFromPath = async (path: string, options: PeCertificatesOptions = {}): Promise<{ record: PeCertificatesInspection; path: string; resolvedPath: string }> => {
  const maxEntries = options.maxEntries ?? DEFAULT_MAX_ENTRIES;
  if (!Number.isInteger(maxEntries) || maxEntries < 1 || maxEntries > 4096) {
    throw peInputError('inspect_pe_certificates', path, 'invalid_value', 'max_entries must be an integer between 1 and 4096.');
  }

  const { bytes, resolvedPath } = await resolvePathBytes(path, {
    ...(options.maxFileBytes === undefined ? {} : { maxFileBytes: options.maxFileBytes }),
    ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
    operation: 'inspect_pe_certificates',
  });

  let image: PeImage;
  try {
    image = parsePeImage(bytes);
  } catch {
    throw peInputError('inspect_pe_certificates', path, 'invalid_format', 'the file is not an MZ PE image.');
  }

  const directory = image.directories[DIR.SECURITY];
  if (directory === undefined || (directory.rva === 0 && directory.size === 0)) {
    return {
      path,
      resolvedPath,
      record: {
        artifact: { path, sha256: createHash('sha256').update(bytes).digest('hex'), bytes: bytes.length },
        format: image.format,
        machine: image.machine,
        table: null,
        entries: [],
        coverage: { status: 'complete', examined_entries: 0, certificates: 0 },
        limitations: [...PE_CERT_LIMITATIONS],
      },
    };
  }

  // SECURITY directory uses a file offset, not an RVA.
  const tableOffset = directory.rva;
  const tableSize = directory.size;
  if (tableOffset + tableSize > bytes.length) {
    throw peInputError('inspect_pe_certificates', path, 'invalid_format', 'the security directory is truncated.');
  }

  const entries: PeCertificateEntry[] = [];
  let cursor = tableOffset;
  const end = tableOffset + tableSize;
  while (cursor + 8 <= end) {
    if (entries.length >= maxEntries) {
      throw peInputError('inspect_pe_certificates', path, 'invalid_value', `the security table exceeds max_entries=${maxEntries}`);
    }
    const length = bytes.readUInt32LE(cursor);
    const revision = bytes.readUInt16LE(cursor + 4);
    const certificateType = bytes.readUInt16LE(cursor + 6);
    if (length < 8 || cursor + length > end) {
      throw peInputError('inspect_pe_certificates', path, 'invalid_format', 'a WIN_CERTIFICATE entry is truncated.');
    }
    const payloadOffset = cursor + 8;
    const declaredPayloadBytes = length - 8;
    const declaredPayload = bytes.subarray(payloadOffset, payloadOffset + declaredPayloadBytes);
    // WIN_CERTIFICATE length is 8-byte aligned; trailing pad zeros are not part of the PKCS#7 blob.
    let payloadBytes = declaredPayloadBytes;
    while (payloadBytes > 0 && declaredPayload[payloadBytes - 1] === 0) payloadBytes -= 1;
    const payload = declaredPayload.subarray(0, payloadBytes);
    const name = typeName(certificateType);
    let pkcs7: PePkcs7 | null = null;
    if (name === 'pkcs7') {
      try {
        pkcs7 = parsePkcs7(payload, payloadOffset);
      } catch (error) {
        throw peInputError('inspect_pe_certificates', path, 'invalid_format', `PKCS#7 decode failed: ${(error as Error).message}`);
      }
    }
    entries.push({
      index: entries.length,
      location: { offset: cursor, bytes: length },
      length,
      revision,
      certificate_type: certificateType,
      certificate_type_name: name,
      payload: { location: { offset: payloadOffset, bytes: payloadBytes }, bytes: payloadBytes, sha256: createHash('sha256').update(payload).digest('hex') },
      pkcs7,
    });
    const next = align8(cursor + length);
    if (next <= cursor) break;
    cursor = next;
  }

  return {
    path,
    resolvedPath,
    record: {
      artifact: { path, sha256: createHash('sha256').update(bytes).digest('hex'), bytes: bytes.length },
      format: image.format,
      machine: image.machine,
      table: {
        location: { offset: tableOffset, bytes: tableSize },
        data_directory_location: { offset: directory.entryOffset, bytes: 8 },
      },
      entries,
      coverage: {
        status: 'complete',
        examined_entries: entries.length,
        certificates: entries.reduce((sum, entry) => sum + (entry.pkcs7?.certificates.length ?? 0), 0),
      },
      limitations: [...PE_CERT_LIMITATIONS],
    },
  };
};
