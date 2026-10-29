const FILE_ALIGN = 0x200;
const SECTION_RVA = 0x1000;

const u16 = (bytes: Buffer, offset: number, value: number): void => {
  bytes.writeUInt16LE(value, offset);
};

const u32 = (bytes: Buffer, offset: number, value: number): void => {
  bytes.writeUInt32LE(value, offset);
};

const u64 = (bytes: Buffer, offset: number, value: bigint): void => {
  bytes.writeBigUInt64LE(value, offset);
};

const pad = (bytes: Buffer): Buffer => Buffer.concat([bytes, Buffer.alloc((FILE_ALIGN - (bytes.length % FILE_ALIGN)) % FILE_ALIGN)]);

const align4 = (bytes: Buffer): Buffer => Buffer.concat([bytes, Buffer.alloc((4 - (bytes.length % 4)) % 4)]);

const buildPe = (spec: { readonly machine: number; readonly text: Buffer; readonly cli: boolean }): Buffer => {
  const dos = Buffer.alloc(0x80);
  u16(dos, 0, 0x5a4d);
  u32(dos, 0x3c, 0x80);
  const optionalSize = 0xf0;
  const coff = Buffer.alloc(20);
  u16(coff, 0, spec.machine);
  u16(coff, 2, 1);
  u16(coff, 16, optionalSize);
  u16(coff, 18, 0x22);
  const optional = Buffer.alloc(optionalSize);
  u16(optional, 0, 0x20b);
  u32(optional, 16, SECTION_RVA);
  u64(optional, 24, 0x1_4000_0000n);
  u32(optional, 32, SECTION_RVA);
  u32(optional, 36, FILE_ALIGN);
  u32(optional, 56, SECTION_RVA + 0x1000);
  u32(optional, 60, FILE_ALIGN);
  u32(optional, 108, 16);
  if (spec.cli) {
    u32(optional, 112 + 14 * 8, SECTION_RVA);
    u32(optional, 112 + 14 * 8 + 4, 72);
  }
  const section = Buffer.alloc(40);
  section.write('.text\0\0\0', 0, 'latin1');
  u32(section, 8, spec.text.length);
  u32(section, 12, SECTION_RVA);
  u32(section, 16, spec.text.length);
  u32(section, 20, FILE_ALIGN);
  u32(section, 36, 0x4000_0040);
  const headers = Buffer.concat([dos, Buffer.from('PE\0\0', 'latin1'), coff, optional, section]);
  return Buffer.concat([headers, Buffer.alloc(FILE_ALIGN - headers.length), pad(spec.text)]);
};

const buildMetadata = (spec: { readonly streams: readonly (readonly [string, Buffer])[] }): Buffer => {
  const version = Buffer.from('v4.0.30319\0\0', 'latin1');
  const headerLength = 16 + version.length + 4;
  const headerSizes = spec.streams.map(([name]) => 8 + name.length + 1 + ((4 - ((name.length + 1) % 4)) % 4));
  const headersLength = headerSizes.reduce((sum, size) => sum + size, 0);
  let dataOffset = headerLength + headersLength;
  const dataOffsets: number[] = [];
  for (const [, data] of spec.streams) {
    dataOffsets.push(dataOffset);
    dataOffset += data.length + ((4 - (data.length % 4)) % 4);
  }
  const root = Buffer.alloc(headerLength);
  root.write('BSJB', 0, 'latin1');
  u16(root, 4, 1);
  u16(root, 6, 1);
  u32(root, 12, version.length);
  version.copy(root, 16);
  u16(root, 16 + version.length, 0);
  u16(root, 16 + version.length + 2, spec.streams.length);
  const streamHeaders = Buffer.concat(
    spec.streams.map(([name, data], index) => {
      const header = Buffer.alloc(8 + name.length + 1);
      u32(header, 0, dataOffsets[index] ?? 0);
      u32(header, 4, data.length);
      header.write(name, 8, 'latin1');
      return align4(header);
    }),
  );
  const streamData = Buffer.concat(spec.streams.map(([, data]) => align4(data)));
  return Buffer.concat([root, streamHeaders, streamData]);
};

const moduleTable = (spec: { readonly moduleRows: number; readonly nameIndex: number; readonly mvidIndex: number; readonly truncate?: number }): Buffer => {
  const table = Buffer.alloc(44);
  u16(table, 4, 2);
  table[6] = 0x01;
  table[7] = 1;
  u64(table, 8, 1n);
  u32(table, 24, spec.moduleRows);
  u16(table, 28, 0);
  u32(table, 30, spec.nameIndex);
  u32(table, 34, spec.mvidIndex);
  return spec.truncate === undefined ? table : table.subarray(0, spec.truncate);
};

const cliHeader = (metadata: Buffer): Buffer => {
  const header = Buffer.alloc(72);
  u32(header, 0, 72);
  u16(header, 4, 2);
  u16(header, 6, 5);
  u32(header, 8, SECTION_RVA + 72);
  u32(header, 12, metadata.length);
  u32(header, 16, 1);
  return Buffer.concat([header, metadata]);
};

export interface ManagedFixtureSpec {
  readonly machine?: number;
  readonly moduleRows?: number;
  readonly mvid?: Buffer;
  readonly includeTables?: boolean;
  readonly truncateTablesAt?: number;
  readonly streams?: readonly (readonly [string, Buffer])[];
}

export const managedPeFixture = (spec: ManagedFixtureSpec = {}): Buffer => {
  const mvid = spec.mvid ?? Buffer.alloc(16);
  const strings = Buffer.concat([Buffer.from([0]), Buffer.from('Fixture.dll\0', 'latin1')]);
  const streams = spec.streams ?? [
    ...(spec.includeTables === false ? [] : ([['#~', moduleTable({ moduleRows: spec.moduleRows ?? 1, nameIndex: 1, mvidIndex: 1, ...(spec.truncateTablesAt === undefined ? {} : { truncate: spec.truncateTablesAt }) })]] as const)),
    ['#Strings', strings] as const,
    ['#GUID', Buffer.concat([mvid, Buffer.alloc(16)])] as const,
  ];
  return buildPe({ machine: spec.machine ?? 0x8664, text: cliHeader(buildMetadata({ streams })), cli: true });
};
