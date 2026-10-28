import { invalidRequest, type ReaError } from '../contract/errors.ts';

export type PlistValue = null | boolean | number | string | PlistValue[] | { [key: string]: PlistValue } | PlistTypedValue;

export interface PlistTypedValue {
  readonly $plist_type: 'data' | 'date';
  readonly base64?: string;
  readonly iso8601?: string;
}

export type PlistFormat = 'xml' | 'binary';

const BINARY_MAGIC = Buffer.from('bplist00', 'latin1');

export const detectFormat = (bytes: Buffer): PlistFormat | undefined => {
  if (bytes.length >= BINARY_MAGIC.length && bytes.subarray(0, BINARY_MAGIC.length).equals(BINARY_MAGIC)) return 'binary';
  const head = bytes
    .subarray(0, 512)
    .toString('utf8')
    .replace(/^\uFEFF/, '')
    .trimStart();
  if (head.startsWith('<?xml') || head.startsWith('<!DOCTYPE') || head.startsWith('<plist')) return 'xml';
  return undefined;
};

const sortedObject = (entries: readonly [string, PlistValue][]): { [key: string]: PlistValue } => Object.fromEntries([...entries].sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0)));

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

const decodeEntities = (text: string): string =>
  text.replaceAll(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (match, entity: string) => {
    if (entity.startsWith('#x') || entity.startsWith('#X')) return String.fromCodePoint(Number.parseInt(entity.slice(2), 16));
    if (entity.startsWith('#')) return String.fromCodePoint(Number.parseInt(entity.slice(1), 10));
    return ENTITIES[entity] ?? match;
  });

interface XmlCursor {
  readonly text: string;
  position: number;
}

const skipIgnorable = (cursor: XmlCursor): void => {
  for (;;) {
    const rest = cursor.text.slice(cursor.position);
    if (rest.startsWith('<?')) {
      const end = cursor.text.indexOf('?>', cursor.position);
      cursor.position = end === -1 ? cursor.text.length : end + 2;
      continue;
    }
    if (rest.startsWith('<!--')) {
      const end = cursor.text.indexOf('-->', cursor.position);
      cursor.position = end === -1 ? cursor.text.length : end + 3;
      continue;
    }
    if (rest.startsWith('<!DOCTYPE')) {
      const end = cursor.text.indexOf('>', cursor.position);
      cursor.position = end === -1 ? cursor.text.length : end + 1;
      continue;
    }
    const whitespace = /^\s+/u.exec(rest);
    if (whitespace !== null) {
      cursor.position += whitespace[0].length;
      continue;
    }
    return;
  }
};

const readElementText = (cursor: XmlCursor): { name: string; text: string } => {
  const open = /^<([a-zA-Z0-9]+)>/u.exec(cursor.text.slice(cursor.position));
  if (open === null) throw new Error(`expected an element at offset ${cursor.position}`);
  const name = open[1] as string;
  cursor.position += open[0].length;
  const close = `</${name}>`;
  const end = cursor.text.indexOf(close, cursor.position);
  if (end === -1) throw new Error(`unterminated <${name}> element`);
  const text = decodeEntities(cursor.text.slice(cursor.position, end));
  cursor.position = end + close.length;
  return { name, text };
};

const consumeOpenTag = (cursor: XmlCursor, name: string): boolean => {
  const match = new RegExp(`^<${name}(?:\\s[^>]*)?/?>`, 'u').exec(cursor.text.slice(cursor.position));
  if (match === null) return false;
  cursor.position += match[0].length;
  return true;
};

const readSelfClosing = (cursor: XmlCursor, name: string): boolean => {
  const token = `<${name}/>`;
  if (cursor.text.startsWith(token, cursor.position)) {
    cursor.position += token.length;
    return true;
  }
  return false;
};

const readValue = (cursor: XmlCursor): PlistValue => {
  skipIgnorable(cursor);
  if (readSelfClosing(cursor, 'true')) return true;
  if (readSelfClosing(cursor, 'false')) return false;
  const rest = cursor.text.slice(cursor.position);
  if (rest.startsWith('<dict>')) {
    consumeOpenTag(cursor, 'dict');
    const entries: [string, PlistValue][] = [];
    for (;;) {
      skipIgnorable(cursor);
      if (cursor.text.startsWith('</dict>', cursor.position)) {
        cursor.position += '</dict>'.length;
        return sortedObject(entries);
      }
      const key = readElementText(cursor);
      if (key.name !== 'key') throw new Error(`expected <key>, found <${key.name}>`);
      entries.push([key.text, readValue(cursor)]);
    }
  }
  if (rest.startsWith('<array>')) {
    consumeOpenTag(cursor, 'array');
    const items: PlistValue[] = [];
    for (;;) {
      skipIgnorable(cursor);
      if (cursor.text.startsWith('</array>', cursor.position)) {
        cursor.position += '</array>'.length;
        return items;
      }
      items.push(readValue(cursor));
    }
  }
  if (readSelfClosing(cursor, 'data')) return { $plist_type: 'data', base64: '' };
  if (readSelfClosing(cursor, 'string')) return '';
  if (readSelfClosing(cursor, 'date')) return { $plist_type: 'date', iso8601: '1970-01-01T00:00:00.000Z' };
  if (rest.startsWith('</')) throw new Error('a <key> element has no value');
  const unknownSelfClosing = /^<([a-zA-Z0-9]+)\s*\/>/u.exec(rest);
  if (unknownSelfClosing !== null) throw new Error(`unsupported element <${unknownSelfClosing[1]}>`);
  const element = readElementText(cursor);
  switch (element.name) {
    case 'string':
      return element.text;
    case 'integer': {
      const integer = Number.parseInt(element.text.replaceAll('_', '').trim(), 10);
      if (Number.isNaN(integer)) throw new Error('an <integer> element has no number');
      return integer;
    }
    case 'real': {
      const real = Number.parseFloat(element.text.trim());
      if (Number.isNaN(real)) throw new Error('a <real> element has no number');
      return real;
    }
    case 'data':
      return { $plist_type: 'data', base64: element.text.replaceAll(/\s+/gu, '') };
    case 'date': {
      const parsed = new Date(element.text.trim());
      if (Number.isNaN(parsed.getTime())) throw new Error('a <date> element has no ISO-8601 date');
      return { $plist_type: 'date', iso8601: parsed.toISOString() };
    }
    case 'key':
      throw new Error('a <key> element has no value');
    default:
      throw new Error(`unsupported element <${element.name}>`);
  }
};

export const parseXmlPlist = (text: string): PlistValue => {
  const cursor: XmlCursor = { text, position: 0 };
  skipIgnorable(cursor);
  if (!consumeOpenTag(cursor, 'plist')) throw new Error('no <plist> element');
  const value = readValue(cursor);
  skipIgnorable(cursor);
  if (!cursor.text.startsWith('</plist>', cursor.position)) throw new Error('no closing </plist> element');
  cursor.position += '</plist>'.length;
  skipIgnorable(cursor);
  if (cursor.position !== cursor.text.length) throw new Error('trailing content after </plist>');
  return value;
};

interface BinaryTrailer {
  readonly offsetIntSize: number;
  readonly objectRefSize: number;
  readonly objectCount: number;
  readonly topObject: number;
  readonly offsetTableOffset: number;
}

const readTrailer = (bytes: Buffer): BinaryTrailer => {
  if (bytes.length < 40) throw new Error('file is too short for a binary property list');
  const trailer = bytes.subarray(bytes.length - 32);
  return {
    offsetIntSize: trailer.readUInt8(6),
    objectRefSize: trailer.readUInt8(7),
    objectCount: Number(trailer.readBigUInt64BE(8)),
    topObject: Number(trailer.readBigUInt64BE(16)),
    offsetTableOffset: Number(trailer.readBigUInt64BE(24)),
  };
};

const readSized = (bytes: Buffer, position: number, size: number): number => {
  if (size > 6) return Number(bytes.readBigUInt64BE(position));
  return bytes.readUIntBE(position, size);
};

export const parseBinaryPlist = (bytes: Buffer): PlistValue => {
  const trailer = readTrailer(bytes);
  if (trailer.offsetIntSize < 1 || trailer.offsetIntSize > 8) throw new Error('unsupported offset integer size');
  if (trailer.objectRefSize < 1 || trailer.objectRefSize > 8) throw new Error('unsupported object reference size');
  if (trailer.offsetTableOffset >= bytes.length) throw new Error('offset table lies outside the file');

  const offsets: number[] = [];
  for (let index = 0; index < trailer.objectCount; index += 1) {
    const at = trailer.offsetTableOffset + index * trailer.offsetIntSize;
    if (at + trailer.offsetIntSize > bytes.length) throw new Error('offset table is truncated');
    offsets.push(readSized(bytes, at, trailer.offsetIntSize));
  }

  const readLength = (position: number, nibble: number): { length: number; next: number } => {
    if (nibble !== 0x0f) return { length: nibble, next: position };
    const intType = bytes.readUInt8(position) as number;
    if ((intType & 0xf0) !== 0x10) throw new Error('an extended length must be encoded as an integer');
    const size = 2 ** (intType & 0x0f);
    return { length: readSized(bytes, position + 1, size), next: position + 1 + size };
  };

  const decode = (index: number, depth = 0): PlistValue => {
    if (depth > 128) throw new Error('binary property list nests too deeply');
    const offset = offsets[index];
    if (offset === undefined || offset >= bytes.length) throw new Error('object offset lies outside the file');
    const marker = bytes.readUInt8(offset);
    const type = marker & 0xf0;
    const nibble = marker & 0x0f;
    switch (type) {
      case 0x00:
        if (marker === 0x08) return false;
        if (marker === 0x09) return true;
        return null;
      case 0x10: {
        const size = 2 ** nibble;
        if (size <= 6) return bytes.readIntBE(offset + 1, size);
        const wide = bytes.readBigInt64BE(offset + 1);
        return wide >= BigInt(Number.MIN_SAFE_INTEGER) && wide <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(wide) : wide.toString();
      }
      case 0x20:
        if (nibble === 2) return bytes.readFloatBE(offset + 1);
        if (nibble === 3) return bytes.readDoubleBE(offset + 1);
        throw new Error(`unsupported real width 2**${nibble}`);
      case 0x30:
        if (nibble !== 0x03) throw new Error(`unsupported object marker 0x${marker.toString(16)}`);
        return { $plist_type: 'date', iso8601: appleEpochToIso(bytes.readDoubleBE(offset + 1)) };
      case 0x40: {
        const { length, next } = readLength(offset + 1, nibble);
        return { $plist_type: 'data', base64: bytes.subarray(next, next + length).toString('base64') };
      }
      case 0x50: {
        const { length, next } = readLength(offset + 1, nibble);
        return bytes.subarray(next, next + length).toString('ascii');
      }
      case 0x60: {
        const { length, next } = readLength(offset + 1, nibble);
        return swapUtf16(bytes.subarray(next, next + length * 2));
      }
      case 0x80: {
        const { next } = readLength(offset + 1, nibble);
        return readSized(bytes, next, nibble + 1);
      }
      case 0xa0:
      case 0xc0: {
        const { length, next } = readLength(offset + 1, nibble);
        const items: PlistValue[] = [];
        for (let item = 0; item < length; item += 1) items.push(decode(readSized(bytes, next + item * trailer.objectRefSize, trailer.objectRefSize), depth + 1));
        return items;
      }
      case 0xd0: {
        const { length, next } = readLength(offset + 1, nibble);
        const entries: [string, PlistValue][] = [];
        for (let item = 0; item < length; item += 1) {
          const key = decode(readSized(bytes, next + item * trailer.objectRefSize, trailer.objectRefSize), depth + 1);
          const value = decode(readSized(bytes, next + (length + item) * trailer.objectRefSize, trailer.objectRefSize), depth + 1);
          entries.push([typeof key === 'string' ? key : String(key), value]);
        }
        return sortedObject(entries);
      }
      default:
        throw new Error(`unsupported object marker 0x${marker.toString(16)}`);
    }
  };

  return decode(trailer.topObject);
};

const swapUtf16 = (bytes: Buffer): string => {
  const swapped = Buffer.from(bytes);
  for (let index = 0; index + 1 < swapped.length; index += 2) {
    const high = swapped[index] as number;
    swapped[index] = swapped[index + 1] as number;
    swapped[index + 1] = high;
  }
  return swapped.toString('utf16le');
};

const APPLE_EPOCH_OFFSET_MS = Date.UTC(2001, 0, 1);
const appleEpochToIso = (seconds: number): string => new Date(APPLE_EPOCH_OFFSET_MS + seconds * 1000).toISOString();

export interface PlistInspection {
  readonly format: PlistFormat;
  readonly value: PlistValue;
  readonly typedValuesPresent: boolean;
}

export const decodePlist = (bytes: Buffer): PlistInspection => {
  const format = detectFormat(bytes);
  if (format === undefined) throw new Error('not a property list');
  const value = format === 'binary' ? parseBinaryPlist(bytes) : parseXmlPlist(bytes.toString('utf8'));
  return { format, value, typedValuesPresent: containsTypedValue(value) };
};

const containsTypedValue = (value: PlistValue): boolean => {
  if (Array.isArray(value)) return value.some(containsTypedValue);
  if (value === null || typeof value !== 'object') return false;
  const record = value as Record<string, unknown>;
  if (record['$plist_type'] !== undefined) return true;
  return Object.values(record).some((nested) => containsTypedValue(nested as PlistValue));
};

export interface PlistBundleProjection {
  readonly identifier: string | null;
  readonly executable: string | null;
  readonly name: string | null;
  readonly version: string | null;
  readonly short_version: string | null;
}

const bundleString = (value: PlistValue, key: string): string | null => {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null;
  const entry = (value as Record<string, PlistValue>)[key];
  return typeof entry === 'string' ? entry : null;
};

export const projectBundle = (value: PlistValue): PlistBundleProjection => ({
  identifier: bundleString(value, 'CFBundleIdentifier'),
  executable: bundleString(value, 'CFBundleExecutable'),
  name: bundleString(value, 'CFBundleName'),
  version: bundleString(value, 'CFBundleVersion'),
  short_version: bundleString(value, 'CFBundleShortVersionString'),
});

export const TYPED_VALUE_LIMITATION = 'Data and date values are projected as typed objects such as { "$plist_type": "data", "base64": … }, because a property list can carry values JSON cannot represent.';

export const plistInputError = (path: string, detail: string): ReaError =>
  invalidRequest('The inspection input is not usable. Check the argument and retry.', {
    operation: 'inspect_plist',
    issues: [{ path: ['path'], reason: 'invalid_value', message: `Cannot inspect ${path}: ${detail}.` }],
  });
