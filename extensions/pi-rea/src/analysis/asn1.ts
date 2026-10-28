export interface DerNode {
  readonly tag: number;
  readonly offset: number;
  readonly headerBytes: number;
  readonly length: number;
  readonly contentOffset: number;
  readonly end: number;
}

export const readDerNode = (bytes: Buffer, offset: number): DerNode => {
  const tag = bytes[offset];
  if (tag === undefined) throw new Error('truncated DER');
  let cursor = offset + 1;
  const first = bytes[cursor];
  if (first === undefined) throw new Error('truncated DER length');
  cursor += 1;
  let length = 0;
  if ((first & 0x80) === 0) length = first;
  else {
    const count = first & 0x7f;
    if (count === 0 || count > 4 || cursor + count > bytes.length) throw new Error('invalid DER length');
    for (let index = 0; index < count; index += 1) {
      const byte = bytes[cursor + index];
      if (byte === undefined) throw new Error('invalid DER length');
      length = (length << 8) | byte;
    }
    cursor += count;
  }
  const contentOffset = cursor;
  const end = contentOffset + length;
  if (end > bytes.length) throw new Error('truncated DER content');
  return { tag, offset, headerBytes: contentOffset - offset, length, contentOffset, end };
};

export const derChildren = (bytes: Buffer, node: DerNode): DerNode[] => {
  if ((node.tag & 0x20) === 0) return [];
  const children: DerNode[] = [];
  let cursor = node.contentOffset;
  while (cursor < node.end) {
    const child = readDerNode(bytes, cursor);
    children.push(child);
    cursor = child.end;
  }
  return children;
};

export const derOid = (bytes: Buffer, node: DerNode): string => {
  if (node.tag !== 0x06) throw new Error('expected OID');
  const body = bytes.subarray(node.contentOffset, node.end);
  const firstByte = body[0];
  if (firstByte === undefined) return '';
  const values = [Math.floor(firstByte / 40), firstByte % 40];
  let value = 0;
  for (let index = 1; index < body.length; index += 1) {
    const byte = body[index];
    if (byte === undefined) break;
    value = (value << 7) | (byte & 0x7f);
    if ((byte & 0x80) === 0) {
      values.push(value);
      value = 0;
    }
  }
  return values.join('.');
};

export const derIntegerHex = (bytes: Buffer, node: DerNode): string => bytes.subarray(node.contentOffset, node.end).toString('hex');

export const derUtf8 = (bytes: Buffer, node: DerNode): string => {
  if (node.tag === 0x0c || node.tag === 0x13 || node.tag === 0x14 || node.tag === 0x16 || node.tag === 0x1e) {
    const raw = bytes.subarray(node.contentOffset, node.end);
    return node.tag === 0x1e ? raw.toString('utf16le') : raw.toString('utf8');
  }
  return bytes.subarray(node.contentOffset, node.end).toString('utf8');
};
