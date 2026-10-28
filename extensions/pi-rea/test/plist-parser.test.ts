import { expect, test } from 'vitest';
import { decodePlist, detectFormat, parseBinaryPlist, parseXmlPlist, projectBundle } from '../src/analysis/plist.ts';

const binary = (objects: Buffer[], top = 0): Buffer => {
  const header = Buffer.from('bplist00', 'latin1');
  const offsets: number[] = [];
  let position = header.length;
  for (const object of objects) {
    offsets.push(position);
    position += object.length;
  }
  const offsetTableOffset = position;
  const offsetTable = Buffer.alloc(offsets.length);
  for (const [index, offset] of offsets.entries()) offsetTable.writeUInt8(offset, index);
  const trailer = Buffer.alloc(32);
  trailer.writeUInt8(1, 6);
  trailer.writeUInt8(1, 7);
  trailer.writeBigUInt64BE(BigInt(objects.length), 8);
  trailer.writeBigUInt64BE(BigInt(top), 16);
  trailer.writeBigUInt64BE(BigInt(offsetTableOffset), 24);
  return Buffer.concat([header, ...objects, offsetTable, trailer]);
};

const utf16be = (text: string): Buffer => {
  const swapped = Buffer.from(text, 'utf16le');
  for (let index = 0; index + 1 < swapped.length; index += 2) {
    const high = swapped[index] as number;
    swapped[index] = swapped[index + 1] as number;
    swapped[index + 1] = high;
  }
  return swapped;
};

test('TOOL-060: format detection distinguishes XML, binary and other content', () => {
  expect(detectFormat(Buffer.from('bplist00'))).toBe('binary');
  expect(detectFormat(Buffer.from('<?xml version="1.0"?>'))).toBe('xml');
  expect(detectFormat(Buffer.from('<!DOCTYPE plist PUBLIC "x">'))).toBe('xml');
  expect(detectFormat(Buffer.from('<plist version="1.0"></plist>'))).toBe('xml');
  expect(detectFormat(Buffer.from('\uFEFF  <?xml version="1.0"?>'))).toBe('xml');
  expect(detectFormat(Buffer.from('plain text'))).toBeUndefined();
  expect(detectFormat(Buffer.alloc(0))).toBeUndefined();
});

test('TOOL-060: the binary decoder reads every scalar encoding', () => {
  const objects = [
    Buffer.from([0x09]),
    Buffer.from([0x08]),
    Buffer.from([0x10, 0x2a]),
    Buffer.from([0x11, 0x01, 0x00]),
    Buffer.from([0x12, 0x00, 0x00, 0x01, 0x00]),
    Buffer.from([0x13, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xf4]),
    Buffer.from([0x22, ...Buffer.from(new Float32Array([0.5]).buffer).reverse()]),
    Buffer.from([0x23, ...Buffer.from(new Float64Array([0.25]).buffer).reverse()]),
    Buffer.from([0x53, 0x61, 0x62, 0x63]),
    Buffer.concat([Buffer.from([0x65]), utf16be('héllo')]),
    Buffer.from([0x42, 0x01, 0x02]),
    Buffer.from([0x33, ...Buffer.from(new Float64Array([0]).buffer).reverse()]),
  ];
  const decoded = parseBinaryPlist(binary(objects, 9));
  expect(decoded).toBe('héllo');
  expect(parseBinaryPlist(binary(objects, 0))).toBe(true);
  expect(parseBinaryPlist(binary(objects, 1))).toBe(false);
  expect(parseBinaryPlist(binary(objects, 2))).toBe(42);
  expect(parseBinaryPlist(binary(objects, 3))).toBe(256);
  expect(parseBinaryPlist(binary(objects, 4))).toBe(256);
  expect(parseBinaryPlist(binary(objects, 5))).toBe(-12);
  expect(parseBinaryPlist(binary(objects, 6))).toBe(0.5);
  expect(parseBinaryPlist(binary(objects, 7))).toBe(0.25);
  expect(parseBinaryPlist(binary(objects, 8))).toBe('abc');
  expect(parseBinaryPlist(binary(objects, 10))).toStrictEqual({ $plist_type: 'data', base64: 'AQI=' });
  expect(parseBinaryPlist(binary(objects, 11))).toStrictEqual({ $plist_type: 'date', iso8601: '2001-01-01T00:00:00.000Z' });
});

test('TOOL-060: the binary decoder reads arrays, sets, dictionaries and UIDs', () => {
  const objects = [
    Buffer.from([0x51, 0x61]),
    Buffer.from([0x51, 0x62]),
    Buffer.from([0xa2, 0x00, 0x01]),
    Buffer.from([0xc1, 0x00]),
    Buffer.from([0xd2, 0x00, 0x01, 0x01, 0x00]),
    Buffer.from([0x80, 0x07]),
  ];
  expect(parseBinaryPlist(binary(objects, 2))).toStrictEqual(['a', 'b']);
  expect(parseBinaryPlist(binary(objects, 3))).toStrictEqual(['a']);
  expect(parseBinaryPlist(binary(objects, 4))).toStrictEqual({ a: 'b', b: 'a' });
  expect(parseBinaryPlist(binary(objects, 5))).toBe(7);
});

test('TOOL-060: the binary decoder refuses malformed containers', () => {
  expect(() => parseBinaryPlist(Buffer.from('bplist00'))).toThrowError(/too short/);
  const objects = [Buffer.from([0x50, 0x01, 0x61])];
  const truncated = binary(objects);
  expect(() => parseBinaryPlist(truncated.subarray(0, truncated.length - 20))).toThrowError();
  const badOffsetSize = binary(objects);
  badOffsetSize.writeUInt8(0, badOffsetSize.length - 32 + 6);
  expect(() => parseBinaryPlist(badOffsetSize)).toThrowError(/offset integer size/);
  const badRefSize = binary(objects);
  badRefSize.writeUInt8(9, badRefSize.length - 32 + 7);
  expect(() => parseBinaryPlist(badRefSize)).toThrowError(/object reference size/);
  const badTop = binary(objects);
  badTop.writeBigUInt64BE(99n, badTop.length - 32 + 16);
  expect(() => parseBinaryPlist(badTop)).toThrowError(/offset lies outside/);
  const badOffsetTable = binary(objects);
  badOffsetTable.writeBigUInt64BE(BigInt(badOffsetTable.length), badOffsetTable.length - 32 + 24);
  expect(() => parseBinaryPlist(badOffsetTable)).toThrowError(/offset table lies outside/);
  const unsupported = binary([Buffer.from([0xf0])]);
  expect(() => parseBinaryPlist(unsupported)).toThrowError(/unsupported object marker/);
  const badExtendedLength = binary([Buffer.from([0x4f, 0x50, 0x01, 0x61])]);
  expect(() => parseBinaryPlist(badExtendedLength)).toThrowError(/extended length/);
});

test('TOOL-060: an extended length and a wide integer decode correctly', () => {
  const payload = Buffer.concat([Buffer.from([0x4f, 0x10, 0x10]), Buffer.alloc(16, 0x7f)]);
  const decoded = parseBinaryPlist(binary([payload]));
  expect(decoded).toStrictEqual({ $plist_type: 'data', base64: Buffer.alloc(16, 0x7f).toString('base64') });

  const wide = Buffer.concat([Buffer.from([0x14]), Buffer.alloc(16, 0x7f)]);
  expect(parseBinaryPlist(binary([wide]))).toBe(BigInt.asIntN(64, BigInt('0x7f7f7f7f7f7f7f7f7f7f7f7f7f7f7f7f')).toString());
});

test('TOOL-060: the XML decoder reads every element type', () => {
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<!-- a comment -->
<plist version="1.0">
<dict>
  <key>String</key><string>a &amp; b &lt;c&gt; &#65; &#x42;</string>
  <key>Integer</key><integer>1_000</integer>
  <key>Real</key><real>2.5</real>
  <key>True</key><true/>
  <key>False</key><false/>
  <key>Data</key><data>AQID BA==</data>
  <key>Date</key><date>2026-01-02T03:04:05Z</date>
  <key>Empty data</key><data></data>
  <key>Empty string</key><string></string>
  <key>Array</key><array><string>one</string><array><true/></array></array>
  <key>Empty array</key><array></array>
  <key>Empty dict</key><dict></dict>
</dict>
</plist>`;
  expect(parseXmlPlist(xml)).toStrictEqual({
    Array: ['one', [true]],
    Data: { $plist_type: 'data', base64: 'AQIDBA==' },
    Date: { $plist_type: 'date', iso8601: '2026-01-02T03:04:05.000Z' },
    'Empty array': [],
    'Empty data': { $plist_type: 'data', base64: '' },
    'Empty dict': {},
    'Empty string': '',
    False: false,
    Integer: 1000,
    Real: 2.5,
    String: 'a & b <c> A B',
    True: true,
  });
});

test('TOOL-060: the XML decoder refuses malformed documents', () => {
  const cases: [string, RegExp][] = [
    ['<plist version="1.0"><dict><key>a</key><bogus/></dict></plist>', /unsupported element/],
    ['<plist version="1.0"><dict><key>a</key><date></date></dict></plist>', /no ISO-8601 date/],
    ['<plist version="1.0"><dict><key>a</key><integer></integer></dict></plist>', /no number/],
    ['<plist version="1.0"><dict><key>a</key><real></real></dict></plist>', /no number/],
    ['<plist version="1.0"><dict><value>a</value></dict></plist>', /expected <key>/],
    ['<plist version="1.0"><dict><key>a</key></dict></plist>', /has no value/],
    ['<plist version="1.0"><string>a</plist>', /unterminated/],
    ['<plist version="1.0"><string>a</string>', /no closing/],
    ['<plist version="1.0"><string>a</string></plist>trailing', /trailing content/],
    ['<dict></dict>', /no <plist> element/],
  ];
  for (const [xml, expected] of cases) {
    expect(() => parseXmlPlist(xml), xml).toThrowError(expected);
  }
});

test('TOOL-060: decoding reports typed values and the bundle projection', () => {
  const withData = decodePlist(Buffer.from('<plist version="1.0"><dict><key>Blob</key><data>AQ==</data></dict></plist>'));
  expect(withData.typedValuesPresent).toBe(true);
  expect(decodePlist(Buffer.from('<plist version="1.0"><string>plain</string></plist>')).typedValuesPresent).toBe(false);
  expect(() => decodePlist(Buffer.from('not a plist'))).toThrowError(/not a property list/);
  expect(projectBundle(null)).toStrictEqual({ identifier: null, executable: null, name: null, version: null, short_version: null });
  expect(projectBundle(['nope'])).toStrictEqual({ identifier: null, executable: null, name: null, version: null, short_version: null });
  expect(projectBundle({ CFBundleIdentifier: 7, CFBundleExecutable: 'bin', CFBundleName: 'N', CFBundleVersion: '2', CFBundleShortVersionString: '1' })).toStrictEqual({
    identifier: null,
    executable: 'bin',
    name: 'N',
    version: '2',
    short_version: '1',
  });
});
