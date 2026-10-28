import { coverage } from '../envelope.mjs';

const MARKER = Buffer.from('\xff Go buildinf:', 'latin1');
const MIN_HEADER_BYTES = 16;
const MODERN_HEADER_SIZE = 32;
const VERSION_PREFIX = 'go1.';
const MAX_FAT_ARCHES = 64;
const TEXT_SEARCH_WINDOW = 1 << 20;

const ABSENCE_IS_NOT_EVIDENCE = 'The absence of a readable buildinfo marker is not evidence that the binary is not Go; this result records only that no marker and header were found in the bytes searched.';
const MAPPING_UNAVAILABLE_LIMIT = 'Address-to-offset mapping was unavailable (no matching Mach-O, ELF or PE load segments), so the embedded blob was located by scanning the file; the reported ranges may not cover the exact string bytes.';
const SCAN_LIMIT = 'The embedded buildinfo blob was recovered by scanning the file rather than through the container mapping, so the reported ranges may not cover the exact string bytes.';

const MACHO_KINDS = new Map([
  [0xfeedface, { bits: 32, bigEndian: false }],
  [0xcefaedfe, { bits: 32, bigEndian: true }],
  [0xfeedfacf, { bits: 64, bigEndian: false }],
  [0xcffaedfe, { bits: 64, bigEndian: true }],
]);
const FAT_KINDS = new Map([
  [0xbebafeca, { wide: false, bigEndian: true }],
  [0xbfbafeca, { wide: true, bigEndian: true }],
  [0xcafebabe, { wide: false, bigEndian: false }],
  [0xcafebabf, { wide: true, bigEndian: false }],
]);

export function readGoBuildInfo(bytes) {
  const buf = asBuffer(bytes);
  if (!buf) return unavailable(['The input was not a Buffer or Uint8Array, so no bytes were searched.']);
  const marker = findMarker(buf);
  if (marker.offset === -1) return unavailable(absenceLimits(buf.length, marker.shortOffset));
  const decoded = decodeBlob(buf, marker);
  const parsed = decoded.modinfo ? parseModInfoText(buf, decoded.modinfo) : emptyModInfo();
  return presentResult(buf, marker, decoded, parsed);
}

function asBuffer(bytes) {
  if (Buffer.isBuffer(bytes)) return bytes;
  if (bytes instanceof Uint8Array) return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return null;
}

function findMarker(buf) {
  let offset = buf.indexOf(MARKER, 0);
  let shortOffset = -1;
  while (offset !== -1) {
    if (offset + MIN_HEADER_BYTES <= buf.length) return { offset, ptrSize: buf[offset + 14], flags: buf[offset + 15], shortOffset };
    if (shortOffset === -1) shortOffset = offset;
    offset = buf.indexOf(MARKER, offset + MARKER.length);
  }
  return { offset: -1, ptrSize: 0, flags: 0, shortOffset };
}

function unavailable(limits) {
  return {
    present: false,
    go_version: null,
    build_settings: [],
    modules: [],
    ranges: [],
    coverage: coverage({ status: 'unavailable', limits }),
    limitations: [...limits, ABSENCE_IS_NOT_EVIDENCE],
  };
}

function absenceLimits(searched, shortOffset) {
  const limits = [`Searched all ${searched} bytes for the 14-byte Go buildinfo marker; no usable buildinfo header was found.`];
  if (shortOffset !== -1) limits.push(truncatedMarkerLimit(shortOffset));
  return limits;
}

function truncatedMarkerLimit(offset) {
  return `A buildinfo marker was found at offset ${offset} but fewer than ${MIN_HEADER_BYTES} bytes follow it, so no header could be read.`;
}

function presentResult(buf, marker, decoded, parsed) {
  const limits = [...decoded.limits, ...parsed.limits];
  const partial = decoded.partial || parsed.partial;
  const ranges = [{ field: 'buildinfo-header', start: marker.offset, end: decoded.headerEnd }, ...parsed.ranges];
  const goVersion = decoded.goVersion;
  const versionBytes = goVersion === null || goVersion === undefined ? Buffer.alloc(0) : Buffer.from(String(goVersion), 'latin1');
  const versionLocation = decoded.versionLocation ?? (goVersion === null || goVersion === undefined ? null : { offset: decoded.headerEnd, bytes: versionBytes.length });
  const textWindow = decoded.modinfo;
  const bytesWindow = decoded.modinfoRaw ?? decoded.modinfo;
  const moduleText = textWindow === null || textWindow === undefined ? '' : buf.toString('latin1', textWindow.start, textWindow.end);
  const moduleBytes = bytesWindow === null || bytesWindow === undefined ? Buffer.alloc(0) : buf.subarray(bytesWindow.start, bytesWindow.end);
  const main = parsed.modules.find((entry) => entry.main) ?? null;
  const dependencies = parsed.modules
    .filter((entry) => !entry.main)
    .map((entry) => ({
      path: entry.path,
      version: entry.version,
      sum: entry.sum,
      replacement: entry.replacement,
    }));
  const encoding = (marker.flags & 2) === 2 ? 'inline' : 'pointer';
  return {
    present: true,
    go_version: goVersion,
    build_settings: parsed.settings,
    modules: parsed.modules,
    ranges,
    coverage: coverage({ status: partial ? 'partial' : 'complete', limits }),
    limitations: partial ? limits : [],
    build_info: {
      header_offset: marker.offset,
      encoding,
      go_version: goVersion,
      go_version_bytes_base64: versionBytes.toString('base64'),
      module_text: moduleText,
      module_bytes_base64: moduleBytes.toString('base64'),
      version_location: versionLocation,
      module_location: bytesWindow === null || bytesWindow === undefined ? null : { offset: bytesWindow.start, bytes: bytesWindow.end - bytesWindow.start },
      module: {
        path: main?.path ?? parsed.modules[0]?.path ?? '',
        main: main === null ? null : { path: main.path, version: main.version, sum: main.sum, replacement: main.replacement },
        dependencies,
        settings: parsed.settings,
        unparsed_lines: [],
        unparsed_line_bytes_base64: [],
        complete: !partial,
      },
    },
  };
}

function decodeBlob(buf, marker) {
  const inline = (marker.flags & 2) === 2;
  const attempt = inline ? decodeInlineBlob(buf, marker.offset) : decodeLegacyOrPointer(buf, marker);
  if (attempt.modinfo !== null || !attempt.partial) return attempt;
  const scanned = scanForBlob(buf, marker.offset);
  if (!scanned) return attempt;
  return {
    headerEnd: attempt.headerEnd,
    goVersion: attempt.goVersion ?? scanned.goVersion,
    modinfo: scanned.modinfo,
    partial: true,
    limits: [...attempt.limits, attempt.mappingUnavailable ? MAPPING_UNAVAILABLE_LIMIT : SCAN_LIMIT],
  };
}

function decodeLegacyOrPointer(buf, marker) {
  return decodeLegacyInlineBlob(buf, marker.offset) ?? decodePointerBlob(buf, marker);
}

function decodeInlineBlob(buf, offset) {
  const headerEnd = offset + MODERN_HEADER_SIZE;
  const version = readVarintString(buf, headerEnd, buf.length);
  if (!version || !isPrintableText(version.value)) {
    return failedBlob(headerEnd, 'The inline buildinfo version string is truncated or its length prefix is out of range.');
  }
  const modinfo = readVarintString(buf, version.end, buf.length);
  if (!modinfo) {
    return {
      headerEnd,
      goVersion: version.value,
      versionLocation: { offset: version.start, bytes: version.end - version.start },
      modinfo: null,
      partial: true,
      mappingUnavailable: false,
      limits: ['The inline buildinfo module text is truncated or its length prefix is out of range; the Go version was read but no module list is reported.'],
    };
  }
  const framed = bufferWindow(buf, modinfo.start, modinfo.end);
  return {
    headerEnd,
    goVersion: version.value,
    versionLocation: { offset: version.start, bytes: version.end - version.start },
    modinfo: stripModFraming(buf, modinfo.start, modinfo.end),
    modinfoRaw: framed,
    partial: false,
    mappingUnavailable: false,
    limits: [],
  };
}

function decodeLegacyInlineBlob(buf, offset) {
  const start = offset + MODERN_HEADER_SIZE;
  if (start + VERSION_PREFIX.length > buf.length) return null;
  if (buf.toString('latin1', start, start + VERSION_PREFIX.length) !== VERSION_PREFIX) return null;
  const version = readPrintableLine(buf, start);
  const textStart = version.end < buf.length && buf[version.end] === 0x0a ? version.end + 1 : version.end;
  const textEnd = printableEnd(buf, textStart);
  const modinfo = bufferWindow(buf, textStart, textEnd);
  return {
    headerEnd: offset + MODERN_HEADER_SIZE,
    goVersion: version.value,
    versionLocation: { offset: version.start, bytes: version.end - version.start },
    modinfo,
    modinfoRaw: modinfo,
    partial: false,
    mappingUnavailable: false,
    limits: [],
  };
}

function decodePointerBlob(buf, marker) {
  const { offset, ptrSize, flags } = marker;
  const headerEnd = offset + 16 + 2 * ptrSize;
  if (ptrSize !== 4 && ptrSize !== 8) return failedBlob(headerEnd, `The buildinfo header declares a pointer size of ${ptrSize} (expected 4 or 8).`);
  if (headerEnd > buf.length) return failedBlob(buf.length, 'The buildinfo header is truncated before both string addresses.');
  const mapVa = createVaMapper(buf);
  if (!mapVa) return failedBlob(headerEnd, MAPPING_UNAVAILABLE_LIMIT, true);
  const bigEndian = (flags & 1) === 1;
  const version = readGoString(buf, readPtr(buf, offset + 16, ptrSize, bigEndian), ptrSize, bigEndian, mapVa);
  if (!version || !isPrintableText(version.value)) return failedBlob(headerEnd, 'The buildinfo version string address could not be resolved to file bytes.');
  const modinfo = readGoString(buf, readPtr(buf, offset + 16 + ptrSize, ptrSize, bigEndian), ptrSize, bigEndian, mapVa);
  if (!modinfo || modinfo.end <= modinfo.start) {
    return failedBlobWithVersion(headerEnd, version.value, 'The buildinfo module text address could not be resolved to file bytes; the Go version was read but no module list is reported.');
  }
  return { headerEnd, goVersion: version.value, modinfo: stripModFraming(buf, modinfo.start, modinfo.end), partial: false, mappingUnavailable: false, limits: [] };
}

function failedBlob(headerEnd, limit, mappingUnavailable = false) {
  return { headerEnd, goVersion: null, modinfo: null, partial: true, mappingUnavailable, limits: [limit] };
}

function failedBlobWithVersion(headerEnd, goVersion, limit, mappingUnavailable = false) {
  return { headerEnd, goVersion, modinfo: null, partial: true, mappingUnavailable, limits: [limit] };
}

function bufferWindow(buf, start, end) {
  return { value: buf.toString('latin1', start, end), start, end };
}

function scanForBlob(buf, from) {
  const version = findVersionText(buf, from);
  if (!version) return null;
  const textStart = locateTextStart(buf, version.end);
  if (textStart === -1) return null;
  const textEnd = printableEnd(buf, textStart);
  if (textEnd <= textStart) return null;
  return { goVersion: version.value, modinfo: bufferWindow(buf, textStart, textEnd) };
}

function findVersionText(buf, from) {
  const near = versionAfter(buf, from);
  return near ?? (from > 0 ? versionAfter(buf, 0) : null);
}

function versionAfter(buf, from) {
  for (let at = buf.indexOf(VERSION_PREFIX, from); at !== -1; at = buf.indexOf(VERSION_PREFIX, at + 1)) {
    const line = readPrintableLine(buf, at);
    if (line.value.length > VERSION_PREFIX.length && line.value === line.value.trim()) return { value: line.value, end: line.end };
  }
  return null;
}

function locateTextStart(buf, versionEnd) {
  const windowEnd = Math.min(buf.length, versionEnd + TEXT_SEARCH_WINDOW);
  const candidates = ['path\t', 'mod\t', 'dep\t', 'build\t'].map((prefix) => buf.indexOf(prefix, versionEnd)).filter((at) => at !== -1 && at < windowEnd);
  if (candidates.length > 0) return Math.min(...candidates);
  return firstModuleLine(buf, versionEnd, windowEnd);
}

function firstModuleLine(buf, start, limit) {
  let at = start;
  while (at < limit) {
    const line = nextLine(buf, at, limit);
    if (parseModuleEntry(line.text)?.kind === 'module') return line.start;
    if (line.next <= at) return -1;
    at = line.next;
  }
  return -1;
}

function stripModFraming(buf, start, end) {
  const length = end - start;
  const framed = length >= 33 && buf[end - 17] === 0x0a && hasBinaryPrefix(buf, start);
  const innerStart = framed ? start + 16 : start;
  const innerEnd = framed ? end - 16 : end;
  return bufferWindow(buf, innerStart, innerEnd);
}

function hasBinaryPrefix(buf, start) {
  for (let index = 0; index < 16; index += 1) {
    if (!isPrintableByte(buf[start + index])) return true;
  }
  return false;
}

function isPrintableByte(byte) {
  return byte !== undefined && (byte === 0x09 || byte === 0x0a || byte === 0x0d || (byte >= 0x20 && byte <= 0x7e));
}

function isPrintableText(text) {
  for (let index = 0; index < text.length; index += 1) {
    if (!isPrintableByte(text.charCodeAt(index))) return false;
  }
  return text.length > 0;
}

function printableEnd(buf, start) {
  let at = Math.max(0, start);
  while (at < buf.length && isPrintableByte(buf[at])) at += 1;
  return at;
}

function readPrintableLine(buf, start) {
  let at = start;
  while (at < buf.length && buf[at] !== 0x0a && isPrintableByte(buf[at])) at += 1;
  return { value: buf.toString('latin1', start, at), end: at };
}

function readVarintString(buf, offset, limit) {
  const length = readUvarint(buf, offset, limit);
  if (!length || length.value > limit - length.next) return null;
  return bufferWindow(buf, length.next, length.next + length.value);
}

function readUvarint(buf, offset, limit) {
  let value = 0;
  let cursor = offset;
  for (let shift = 0; cursor < limit && shift < 56; shift += 7) {
    const byte = buf[cursor];
    cursor += 1;
    value += (byte & 0x7f) * 2 ** shift;
    if (!Number.isSafeInteger(value)) return null;
    if ((byte & 0x80) === 0) return { value, next: cursor };
  }
  return null;
}

function readPtr(buf, at, ptrSize, bigEndian) {
  if (at === null || at < 0 || at + ptrSize > buf.length) return null;
  if (ptrSize === 4) return bigEndian ? buf.readUInt32BE(at) : buf.readUInt32LE(at);
  return Number(bigEndian ? buf.readBigUInt64BE(at) : buf.readBigUInt64LE(at));
}

function readGoString(buf, address, ptrSize, bigEndian, mapVa) {
  if (address === null || address === undefined) return null;
  const headerAt = mapVa(address);
  if (headerAt === null || headerAt < 0 || headerAt + 2 * ptrSize > buf.length) return null;
  const dataAddress = readPtr(buf, headerAt, ptrSize, bigEndian);
  const length = readPtr(buf, headerAt + ptrSize, ptrSize, bigEndian);
  if (dataAddress === null || length === null) return null;
  const dataAt = mapVa(dataAddress);
  if (dataAt === null || length > buf.length - dataAt) return null;
  return bufferWindow(buf, dataAt, dataAt + length);
}

function createVaMapper(buf) {
  const segments = thinMachoSegments(buf, 0) ?? fatMachoSegments(buf) ?? elfSegments(buf) ?? peSegments(buf);
  if (!segments || segments.length === 0) return null;
  return (address) => {
    for (const segment of segments) {
      if (address >= segment.vmaddr && address < segment.vmaddr + segment.filesize) return segment.fileoff + (address - segment.vmaddr);
    }
    return null;
  };
}

function thinMachoSegments(buf, base) {
  if (base < 0 || base + 4 > buf.length) return null;
  const kind = MACHO_KINDS.get(buf.readUInt32LE(base));
  return kind ? readMachoSegments(buf, base, kind) : null;
}

function readMachoSegments(buf, base, kind) {
  const headerSize = kind.bits === 64 ? 32 : 28;
  const segmentSize = kind.bits === 64 ? 72 : 56;
  const segmentCmd = kind.bits === 64 ? 0x19 : 0x01;
  if (base + headerSize > buf.length) return null;
  const read32 = (at) => (kind.bigEndian ? buf.readUInt32BE(at) : buf.readUInt32LE(at));
  const readWord = (at) => (kind.bits === 64 ? Number(kind.bigEndian ? buf.readBigUInt64BE(at) : buf.readBigUInt64LE(at)) : read32(at));
  const ncmds = read32(base + 16);
  const limit = Math.min(buf.length, base + headerSize + read32(base + 20));
  const segments = [];
  for (let index = 0, offset = base + headerSize; index < ncmds && offset + 8 <= limit; index += 1) {
    const cmdSize = read32(offset + 4);
    if (cmdSize < 8 || offset + cmdSize > limit) break;
    if (read32(offset) === segmentCmd && cmdSize >= segmentSize) {
      const vmaddr = readWord(offset + 24);
      const fileoff = kind.bits === 64 ? readWord(offset + 40) : read32(offset + 32);
      const filesize = kind.bits === 64 ? readWord(offset + 48) : read32(offset + 36);
      if (filesize > 0) segments.push({ vmaddr, fileoff: fileoff + base, filesize });
    }
    offset += cmdSize;
  }
  return segments.length > 0 ? segments : null;
}

function fatMachoSegments(buf) {
  if (buf.length < 8) return null;
  const fat = FAT_KINDS.get(buf.readUInt32LE(0));
  if (!fat) return null;
  const read32 = (at) => (fat.bigEndian ? buf.readUInt32BE(at) : buf.readUInt32LE(at));
  const entrySize = fat.wide ? 32 : 20;
  const count = Math.min(read32(4), MAX_FAT_ARCHES);
  const segments = [];
  for (let index = 0; index < count; index += 1) {
    const entry = 8 + index * entrySize;
    if (entry + entrySize > buf.length) break;
    const slice = fat.wide ? Number(fat.bigEndian ? buf.readBigUInt64BE(entry + 8) : buf.readBigUInt64LE(entry + 8)) : read32(entry + 8);
    const inner = thinMachoSegments(buf, slice);
    if (inner) segments.push(...inner);
  }
  return segments.length > 0 ? segments : null;
}

function elfSegments(buf) {
  if (buf.length < 52 || buf.readUInt32BE(0) !== 0x7f454c46) return null;
  const is64 = buf[4] === 2;
  const bigEndian = buf[5] === 2;
  const read16 = (at) => (bigEndian ? buf.readUInt16BE(at) : buf.readUInt16LE(at));
  const read32 = (at) => (bigEndian ? buf.readUInt32BE(at) : buf.readUInt32LE(at));
  const readWord = (at) => (is64 ? Number(bigEndian ? buf.readBigUInt64BE(at) : buf.readBigUInt64LE(at)) : read32(at));
  const phoff = is64 ? readWord(0x20) : read32(0x1c);
  const phentsize = read16(is64 ? 0x36 : 0x2a);
  const phnum = read16(is64 ? 0x38 : 0x2c);
  const segments = [];
  for (let index = 0; index < phnum; index += 1) {
    const at = phoff + index * phentsize;
    if (at < 0 || at + phentsize > buf.length) break;
    if (read32(at) !== 0x01) continue;
    const fileoff = is64 ? readWord(at + 0x08) : read32(at + 0x04);
    const vmaddr = is64 ? readWord(at + 0x10) : read32(at + 0x08);
    const filesize = is64 ? readWord(at + 0x20) : read32(at + 0x10);
    if (filesize > 0) segments.push({ vmaddr, fileoff, filesize });
  }
  return segments.length > 0 ? segments : null;
}

function peSegments(buf) {
  if (buf.length < 0x40 || buf[0] !== 0x4d || buf[1] !== 0x5a) return null;
  const pe = buf.readUInt32LE(0x3c);
  if (pe < 0 || pe + 24 > buf.length || buf.toString('latin1', pe, pe + 4) !== 'PE\u0000\u0000') return null;
  const optionalAt = pe + 24;
  const optionalSize = buf.readUInt16LE(pe + 20);
  if (optionalAt + optionalSize > buf.length) return null;
  const is64 = buf.readUInt16LE(optionalAt) === 0x20b;
  if (!is64 && buf.readUInt16LE(optionalAt) !== 0x10b) return null;
  const imageBase = is64 ? Number(buf.readBigUInt64LE(optionalAt + 24)) : buf.readUInt32LE(optionalAt + 28);
  const sectionCount = buf.readUInt16LE(pe + 6);
  const sectionsAt = optionalAt + optionalSize;
  const segments = [];
  for (let index = 0; index < sectionCount; index += 1) {
    const at = sectionsAt + index * 40;
    if (at + 40 > buf.length) break;
    const rawSize = buf.readUInt32LE(at + 16);
    if (rawSize > 0) segments.push({ vmaddr: imageBase + buf.readUInt32LE(at + 12), fileoff: buf.readUInt32LE(at + 20), filesize: rawSize });
  }
  return segments.length > 0 ? segments : null;
}

function emptyModInfo() {
  return { modules: [], settings: [], ranges: [], limits: [], partial: false };
}

function parseModInfoText(buf, window) {
  let modules = [];
  let settings = [];
  let moduleStart = null;
  let moduleEnd = null;
  let settingsStart = null;
  let settingsEnd = null;
  let sawLine = false;
  let mode = 'modules';
  let offset = window.start;
  while (offset < window.end) {
    const line = nextLine(buf, offset, window.end);
    offset = line.next;
    if (line.text === '') {
      if (mode === 'modules') mode = 'settings';
      continue;
    }
    sawLine = true;
    if (mode === 'modules' && line.text.startsWith('build\t')) mode = 'settings';
    if (mode === 'modules') {
      const entry = parseModuleEntry(line.text);
      if (entry?.kind === 'module') {
        modules = [...modules, entry.module];
        moduleStart ??= line.start;
        moduleEnd = line.end;
      } else if (entry?.kind === 'replacement') {
        modules = applyReplacement(modules, entry.fields);
        moduleEnd = line.end;
      }
    } else {
      const setting = parseSetting(line.text);
      if (setting) {
        settings = [...settings, setting];
        settingsStart ??= line.start;
        settingsEnd = line.end;
      }
    }
  }
  const rangedModules = assignMain(modules);
  const nothingParsed = sawLine && rangedModules.length === 0 && settings.length === 0;
  return {
    modules: rangedModules,
    settings,
    ranges: buildTextRanges(moduleStart, moduleEnd, settingsStart, settingsEnd),
    limits: nothingParsed ? ['The buildinfo module text did not contain recognizable module or setting lines.'] : [],
    partial: nothingParsed,
  };
}

function buildTextRanges(moduleStart, moduleEnd, settingsStart, settingsEnd) {
  const ranges = [];
  if (moduleStart !== null) ranges.push({ field: 'module-list', start: moduleStart, end: moduleEnd });
  if (settingsStart !== null) ranges.push({ field: 'build-settings', start: settingsStart, end: settingsEnd });
  return ranges;
}

function nextLine(buf, offset, end) {
  const newline = buf.indexOf(0x0a, offset);
  const lineEnd = newline === -1 || newline > end ? end : newline;
  const raw = buf.toString('latin1', offset, lineEnd);
  const text = raw.endsWith('\r') ? raw.slice(0, -1) : raw;
  return { text, start: offset, end: lineEnd, next: lineEnd < end ? lineEnd + 1 : end + 1 };
}

function parseModuleEntry(text) {
  if (text.startsWith('=>\t')) return { kind: 'replacement', fields: splitColumns(text.slice(3)) };
  if (text.startsWith('mod\t') || text.startsWith('dep\t')) {
    const [path, version, sum] = splitColumns(text.slice(4));
    return { kind: 'module', module: { path, version, sum, main: text.startsWith('mod\t'), replacement: null } };
  }
  if (text.startsWith('path\t')) return null;
  return parseSpaceModule(text);
}

function parseSpaceModule(text) {
  const tokens = (text.includes('\t') ? text.split('\t') : text.split(' ')).map((token) => token.trim()).filter((token) => token.length > 0);
  if (tokens.length === 0 || !looksLikeModulePath(tokens[0])) return null;
  const arrow = tokens.indexOf('=>');
  const left = arrow === -1 ? tokens : tokens.slice(0, arrow);
  const right = arrow === -1 ? null : tokens.slice(arrow + 1);
  const module = { path: left[0], version: left[1] ?? '', sum: left[2] ?? '', main: false, replacement: right === null ? null : { path: right[0] ?? '', version: right[1] ?? '' } };
  return { kind: 'module', module };
}

function looksLikeModulePath(token) {
  return /^[A-Za-z0-9._~/!-]+$/.test(token);
}

function splitColumns(text) {
  const columns = text.split('\t');
  return [columns[0] ?? '', columns[1] ?? '', columns[2] ?? ''];
}

function applyReplacement(modules, fields) {
  if (modules.length === 0) return modules;
  const replacement = { path: fields[0] ?? '', version: fields[1] ?? '' };
  return [...modules.slice(0, -1), { ...modules[modules.length - 1], replacement }];
}

function assignMain(modules) {
  if (modules.length === 0 || modules.some((module) => module.main)) return modules;
  const devel = modules.findIndex((module) => module.version === '(devel)');
  const mainIndex = devel === -1 ? 0 : devel;
  return modules.map((module, index) => (index === mainIndex ? { ...module, main: true } : module));
}

function parseSetting(text) {
  const entry = text.startsWith('build\t') ? text.slice(6) : text;
  const equals = entry.indexOf('=');
  if (equals <= 0) return null;
  return { key: unquote(entry.slice(0, equals)), value: unquote(entry.slice(equals + 1)) };
}

function unquote(text) {
  if (text.length < 2) return text;
  const quote = text[0];
  if ((quote !== '"' && quote !== '`') || text[text.length - 1] !== quote) return text;
  if (quote === '`') return text.slice(1, -1);
  try {
    return JSON.parse(text);
  } catch {
    return text.slice(1, -1);
  }
}
